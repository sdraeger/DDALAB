//! Lab Streaming Layer through the liblsl installed beside DDALAB, loaded when a stream is first used: an inlet that
//! pulls a stream's samples, and outlets that publish numbers or text. Nothing links liblsl, so every build runs
//! without it and only `ddalab stream` asks for it.
//!
//! liblsl is found at `DDALAB_LIBLSL`, then `PYLSL_LIB` (pylsl's own variable), then by its platform name on the
//! library path. `pip install pylsl` ships one; the `ddalab` Python package points `DDALAB_LIBLSL` at it.

use crate::error::{DDAError, Result};
use libloading::{Library, Symbol};
use std::ffi::{c_char, c_void, CStr, CString};
use std::sync::OnceLock;

type Handle = *mut c_void;

const CFT_DOUBLE64: i32 = 2;
const CFT_STRING: i32 = 3;

fn lsl_error(message: impl Into<String>) -> DDAError {
    DDAError::InvalidParameter(message.into())
}

/// liblsl, loaded once per process.
fn library() -> Result<&'static Library> {
    static LIBRARY: OnceLock<std::result::Result<Library, String>> = OnceLock::new();
    LIBRARY
        .get_or_init(|| {
            let names = ["DDALAB_LIBLSL", "PYLSL_LIB"]
                .iter()
                .filter_map(|v| std::env::var(v).ok())
                .chain([libloading::library_filename("lsl").to_string_lossy().into_owned()]);
            let mut tried = Vec::new();
            for name in names {
                // Loading a library runs its initializers; liblsl's start its network threads, which is all it does.
                match unsafe { Library::new(&name) } {
                    Ok(library) => return Ok(library),
                    Err(e) => tried.push(format!("{name}: {e}")),
                }
            }
            Err(format!(
                "liblsl was not found ({}). Install it (pip install pylsl ships one) and set DDALAB_LIBLSL to its path",
                tried.join("; ")
            ))
        })
        .as_ref()
        .map_err(|e| lsl_error(e.clone()))
}

/// The liblsl function `name` with signature `T`.
fn function<T>(name: &str) -> Result<Symbol<'static, T>> {
    let library = library()?;
    unsafe { library.get(name.as_bytes()) }
        .map_err(|e| lsl_error(format!("liblsl has no {name}: {e}")))
}

fn text(pointer: *const c_char) -> String {
    if pointer.is_null() {
        String::new()
    } else {
        unsafe { CStr::from_ptr(pointer) }
            .to_string_lossy()
            .into_owned()
    }
}

fn check(code: i32, what: &str) -> Result<()> {
    match code {
        0 => Ok(()),
        -1 => Err(lsl_error(format!("{what}: the stream timed out"))),
        -2 => Err(lsl_error(format!("{what}: the stream was lost"))),
        code => Err(lsl_error(format!("{what}: liblsl error {code}"))),
    }
}

/// What a stream says of itself.
#[derive(Clone, Debug, serde::Serialize)]
pub struct StreamInfo {
    pub name: String,
    pub kind: String,
    pub channels: Vec<String>,
    pub sample_rate_hz: f64,
}

/// A stream's info handle: the name, type, rate and channel labels of its description.
unsafe fn describe(info: Handle) -> Result<StreamInfo> {
    let name: Symbol<unsafe extern "C" fn(Handle) -> *const c_char> = function("lsl_get_name")?;
    let kind: Symbol<unsafe extern "C" fn(Handle) -> *const c_char> = function("lsl_get_type")?;
    let count: Symbol<unsafe extern "C" fn(Handle) -> i32> = function("lsl_get_channel_count")?;
    let rate: Symbol<unsafe extern "C" fn(Handle) -> f64> = function("lsl_get_nominal_srate")?;
    let desc: Symbol<unsafe extern "C" fn(Handle) -> Handle> = function("lsl_get_desc")?;
    let child: Symbol<unsafe extern "C" fn(Handle, *const c_char) -> Handle> =
        function("lsl_child")?;
    let next: Symbol<unsafe extern "C" fn(Handle, *const c_char) -> Handle> =
        function("lsl_next_sibling_n")?;
    let value: Symbol<unsafe extern "C" fn(Handle, *const c_char) -> *const c_char> =
        function("lsl_child_value_n")?;
    let empty: Symbol<unsafe extern "C" fn(Handle) -> i32> = function("lsl_empty")?;
    let n = count(info).max(0) as usize;
    // <desc><channels><channel><label>, when the stream describes its channels.
    let mut labels = Vec::new();
    let (channels, channel, label) = (c"channels", c"channel", c"label");
    let mut at = child(child(desc(info), channels.as_ptr()), channel.as_ptr());
    while labels.len() < n && empty(at) == 0 {
        labels.push(text(value(at, label.as_ptr())));
        at = next(at, channel.as_ptr());
    }
    if labels.len() != n || labels.iter().any(String::is_empty) {
        labels = (1..=n).map(|i| format!("Ch{i}")).collect();
    }
    Ok(StreamInfo {
        name: text(name(info)),
        kind: text(kind(info)),
        channels: labels,
        sample_rate_hz: rate(info),
    })
}

/// Pulls a numeric stream.
pub struct Inlet {
    handle: Handle,
    pub info: StreamInfo,
}

// liblsl's inlets are thread-safe; this one is pulled from one thread at a time.
unsafe impl Send for Inlet {}

impl Inlet {
    /// The first stream whose `prop` ("name" or "type") is `value`, waiting up to `timeout` seconds for one.
    pub fn resolve(prop: &str, value: &str, timeout: f64) -> Result<Inlet> {
        let resolve: Symbol<
            unsafe extern "C" fn(*mut Handle, u32, *const c_char, *const c_char, i32, f64) -> i32,
        > = function("lsl_resolve_byprop")?;
        let create: Symbol<unsafe extern "C" fn(Handle, i32, i32, i32) -> Handle> =
            function("lsl_create_inlet")?;
        let full: Symbol<unsafe extern "C" fn(Handle, f64, *mut i32) -> Handle> =
            function("lsl_get_fullinfo")?;
        let open: Symbol<unsafe extern "C" fn(Handle, f64, *mut i32)> =
            function("lsl_open_stream")?;
        let destroy: Symbol<unsafe extern "C" fn(Handle)> = function("lsl_destroy_streaminfo")?;
        let (prop_c, value_c) = (cstring(prop)?, cstring(value)?);
        let mut found: [Handle; 1] = [std::ptr::null_mut()];
        unsafe {
            if resolve(
                found.as_mut_ptr(),
                1,
                prop_c.as_ptr(),
                value_c.as_ptr(),
                1,
                timeout,
            ) < 1
            {
                return Err(lsl_error(format!(
                    "no LSL stream with {prop} {value} within {timeout} s"
                )));
            }
            // A buffer of 60 s, chunks as they come, recovering a stream that restarts.
            let handle = create(found[0], 60, 0, 1);
            destroy(found[0]);
            let mut code = 0;
            let info = full(handle, 10.0, &mut code);
            check(code, "reading the stream's description")?;
            let described = describe(info);
            destroy(info);
            open(handle, 10.0, &mut code);
            check(code, "opening the stream")?;
            Ok(Inlet {
                handle,
                info: described?,
            })
        }
    }

    /// Up to `out.len() / channels` rows of samples, waiting up to `timeout` seconds for the first; the rows pulled.
    pub fn pull(&mut self, out: &mut [f64], timeout: f64) -> Result<usize> {
        let pull: Symbol<
            unsafe extern "C" fn(Handle, *mut f64, *mut f64, usize, usize, f64, *mut i32) -> usize,
        > = function("lsl_pull_chunk_d")?;
        let width = self.info.channels.len().max(1);
        let rows = out.len() / width;
        let mut stamps = vec![0.0; rows];
        let mut code = 0;
        let values = unsafe {
            pull(
                self.handle,
                out.as_mut_ptr(),
                stamps.as_mut_ptr(),
                rows * width,
                rows,
                timeout,
                &mut code,
            )
        };
        check(code, "pulling samples")?;
        Ok(values / width)
    }
}

impl Drop for Inlet {
    fn drop(&mut self) {
        if let Ok(destroy) = function::<unsafe extern "C" fn(Handle)>("lsl_destroy_inlet") {
            unsafe { destroy(self.handle) };
        }
    }
}

fn cstring(value: &str) -> Result<CString> {
    CString::new(value).map_err(|_| lsl_error(format!("{value:?} holds a NUL byte")))
}

/// Publishes a stream of numbers (one per label) or of text.
pub struct Outlet {
    handle: Handle,
    numeric: bool,
}

unsafe impl Send for Outlet {}

impl Outlet {
    /// A numeric outlet `name` of `kind` with one channel per label at `rate` samples per second; with no labels, a
    /// text outlet of one channel at an irregular rate.
    pub fn new(name: &str, kind: &str, labels: &[String], rate: f64) -> Result<Outlet> {
        let create_info: Symbol<
            unsafe extern "C" fn(
                *const c_char,
                *const c_char,
                i32,
                f64,
                i32,
                *const c_char,
            ) -> Handle,
        > = function("lsl_create_streaminfo")?;
        let desc: Symbol<unsafe extern "C" fn(Handle) -> Handle> = function("lsl_get_desc")?;
        let append: Symbol<unsafe extern "C" fn(Handle, *const c_char) -> Handle> =
            function("lsl_append_child")?;
        let append_value: Symbol<
            unsafe extern "C" fn(Handle, *const c_char, *const c_char) -> Handle,
        > = function("lsl_append_child_value")?;
        let create: Symbol<unsafe extern "C" fn(Handle, i32, i32) -> Handle> =
            function("lsl_create_outlet")?;
        let destroy: Symbol<unsafe extern "C" fn(Handle)> = function("lsl_destroy_streaminfo")?;
        let numeric = !labels.is_empty();
        let (name_c, kind_c, source) = (
            cstring(name)?,
            cstring(kind)?,
            cstring(&format!("ddalab-{name}"))?,
        );
        unsafe {
            let (count, format, rate) = if numeric {
                (labels.len() as i32, CFT_DOUBLE64, rate)
            } else {
                (1, CFT_STRING, 0.0)
            };
            let info = create_info(
                name_c.as_ptr(),
                kind_c.as_ptr(),
                count,
                rate,
                format,
                source.as_ptr(),
            );
            if numeric {
                let channels = append(desc(info), c"channels".as_ptr());
                for label in labels {
                    let label_c = cstring(label)?;
                    append_value(
                        append(channels, c"channel".as_ptr()),
                        c"label".as_ptr(),
                        label_c.as_ptr(),
                    );
                }
            }
            let handle = create(info, 0, 360);
            destroy(info);
            Ok(Outlet { handle, numeric })
        }
    }

    pub fn push(&self, values: &[f64]) -> Result<()> {
        let push: Symbol<unsafe extern "C" fn(Handle, *const f64) -> i32> =
            function("lsl_push_sample_d")?;
        debug_assert!(self.numeric);
        check(
            unsafe { push(self.handle, values.as_ptr()) },
            "publishing a sample",
        )
    }

    pub fn push_text(&self, value: &str) -> Result<()> {
        let push: Symbol<unsafe extern "C" fn(Handle, *const *const c_char) -> i32> =
            function("lsl_push_sample_str")?;
        debug_assert!(!self.numeric);
        let value_c = cstring(value)?;
        let values = [value_c.as_ptr()];
        check(
            unsafe { push(self.handle, values.as_ptr()) },
            "publishing a marker",
        )
    }
}

impl Drop for Outlet {
    fn drop(&mut self) {
        if let Ok(destroy) = function::<unsafe extern "C" fn(Handle)>("lsl_destroy_outlet") {
            unsafe { destroy(self.handle) };
        }
    }
}
