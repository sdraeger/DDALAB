//! Lab Streaming Layer through the liblsl installed beside DDALAB, loaded when a stream is first used: an inlet that
//! pulls a stream's samples, and outlets that publish numbers or text. Nothing links liblsl, so every build runs
//! without it and only `ddalab stream` asks for it.
//!
//! liblsl is found at `DDALAB_LIBLSL`, then `PYLSL_LIB` (pylsl's own variable), then by its platform name on the
//! library path. `pip install pylsl` ships one; the `ddalab` Python package points `DDALAB_LIBLSL` at it.
//!
//! Every handle liblsl returns is checked for null and owned by a type whose `Drop` destroys it, so an early return
//! on an error releases it too. The signatures below follow liblsl 1.17's C headers.

use crate::error::{DDAError, Result};
use libloading::{Library, Symbol};
use std::ffi::{c_char, c_ulong, c_void, CStr, CString};
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
                // SAFETY: loading a library runs its initializers; liblsl's only start its network threads.
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
///
/// # Safety
/// `T` must be the function's C signature as liblsl declares it; calling through a different one is undefined.
unsafe fn function<T>(name: &str) -> Result<Symbol<'static, T>> {
    let library = library()?;
    // SAFETY: the caller guarantees `T` matches the symbol's C signature.
    unsafe { library.get(name.as_bytes()) }
        .map_err(|e| lsl_error(format!("liblsl has no {name}: {e}")))
}

/// The C string at `pointer`, copied; empty for a null pointer.
///
/// # Safety
/// A non-null `pointer` must point to a NUL-terminated string that stays valid during the call.
unsafe fn text(pointer: *const c_char) -> String {
    if pointer.is_null() {
        String::new()
    } else {
        // SAFETY: non-null and NUL-terminated by the caller's guarantee.
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

/// `handle`, or an error naming `what` when liblsl returned null.
fn non_null(handle: Handle, what: &str) -> Result<Handle> {
    if handle.is_null() {
        Err(lsl_error(format!("liblsl could not create {what}")))
    } else {
        Ok(handle)
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

/// A streaminfo handle, destroyed on drop.
struct Info(Handle);

impl Drop for Info {
    fn drop(&mut self) {
        // SAFETY: the signature is liblsl's, and `Info` alone owns the handle liblsl returned.
        unsafe {
            if let Ok(destroy) = function::<unsafe extern "C" fn(Handle)>("lsl_destroy_streaminfo")
            {
                destroy(self.0);
            }
        }
    }
}

impl Info {
    /// The name, type, rate and channel labels of the stream's description.
    fn describe(&self) -> Result<StreamInfo> {
        // SAFETY: each signature is liblsl's, and every handle passed is `self.0` or one liblsl returned from it,
        // which lives as long as `self`. The strings liblsl returns are copied before the next call.
        unsafe {
            let name: Symbol<unsafe extern "C" fn(Handle) -> *const c_char> =
                function("lsl_get_name")?;
            let kind: Symbol<unsafe extern "C" fn(Handle) -> *const c_char> =
                function("lsl_get_type")?;
            let count: Symbol<unsafe extern "C" fn(Handle) -> i32> =
                function("lsl_get_channel_count")?;
            let rate: Symbol<unsafe extern "C" fn(Handle) -> f64> =
                function("lsl_get_nominal_srate")?;
            let desc: Symbol<unsafe extern "C" fn(Handle) -> Handle> = function("lsl_get_desc")?;
            let child: Symbol<unsafe extern "C" fn(Handle, *const c_char) -> Handle> =
                function("lsl_child")?;
            let next: Symbol<unsafe extern "C" fn(Handle, *const c_char) -> Handle> =
                function("lsl_next_sibling_n")?;
            let value: Symbol<unsafe extern "C" fn(Handle, *const c_char) -> *const c_char> =
                function("lsl_child_value_n")?;
            let empty: Symbol<unsafe extern "C" fn(Handle) -> i32> = function("lsl_empty")?;
            let info = self.0;
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
    }
}

/// Pulls a numeric stream.
pub struct Inlet {
    handle: Handle,
    pub info: StreamInfo,
}

// SAFETY: liblsl's inlets are thread-safe, and this one is pulled from one thread at a time (it is not Sync).
unsafe impl Send for Inlet {}

impl Inlet {
    /// The first stream whose `prop` ("name" or "type") is `value`, waiting up to `timeout` seconds for one.
    pub fn resolve(prop: &str, value: &str, timeout: f64) -> Result<Inlet> {
        let (prop_c, value_c) = (cstring(prop)?, cstring(value)?);
        // SAFETY: the signatures are liblsl's. The strings outlive the calls, `found` has room for the one result
        // asked for, and each handle is owned by an `Info` or the `Inlet` as soon as it is checked.
        unsafe {
            let resolve: Symbol<
                unsafe extern "C" fn(
                    *mut Handle,
                    u32,
                    *const c_char,
                    *const c_char,
                    i32,
                    f64,
                ) -> i32,
            > = function("lsl_resolve_byprop")?;
            let create: Symbol<unsafe extern "C" fn(Handle, i32, i32, i32) -> Handle> =
                function("lsl_create_inlet")?;
            let full: Symbol<unsafe extern "C" fn(Handle, f64, *mut i32) -> Handle> =
                function("lsl_get_fullinfo")?;
            let open: Symbol<unsafe extern "C" fn(Handle, f64, *mut i32)> =
                function("lsl_open_stream")?;
            let mut found: [Handle; 1] = [std::ptr::null_mut()];
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
            let resolved = Info(non_null(found[0], "the resolved stream's info")?);
            // A buffer of 60 s, chunks as they come, recovering a stream that restarts.
            let mut inlet = Inlet {
                handle: non_null(create(resolved.0, 60, 0, 1), "an inlet")?,
                info: StreamInfo {
                    name: String::new(),
                    kind: String::new(),
                    channels: Vec::new(),
                    sample_rate_hz: 0.0,
                },
            };
            drop(resolved);
            let mut code = 0;
            let info = full(inlet.handle, 10.0, &mut code);
            check(code, "reading the stream's description")?;
            inlet.info = Info(non_null(info, "the stream's description")?).describe()?;
            open(inlet.handle, 10.0, &mut code);
            check(code, "opening the stream")?;
            Ok(inlet)
        }
    }

    /// Up to `out.len() / channels` rows of samples, waiting up to `timeout` seconds for the first; the rows pulled.
    pub fn pull(&mut self, out: &mut [f64], timeout: f64) -> Result<usize> {
        let width = self.info.channels.len().max(1);
        let rows = out.len() / width;
        let to_c = |n: usize| {
            c_ulong::try_from(n)
                .map_err(|_| lsl_error(format!("{n} values exceed liblsl's chunk size")))
        };
        let (capacity, stamp_capacity) = (to_c(rows * width)?, to_c(rows)?);
        let mut stamps = vec![0.0; rows];
        let mut code = 0;
        // SAFETY: liblsl declares `unsigned long lsl_pull_chunk_d(inlet, double*, double*, unsigned long,
        // unsigned long, double, int*)`; it writes at most `capacity` values into `out` and `stamp_capacity` stamps,
        // both within the buffers passed.
        let values = unsafe {
            let pull: Symbol<
                unsafe extern "C" fn(
                    Handle,
                    *mut f64,
                    *mut f64,
                    c_ulong,
                    c_ulong,
                    f64,
                    *mut i32,
                ) -> c_ulong,
            > = function("lsl_pull_chunk_d")?;
            pull(
                self.handle,
                out.as_mut_ptr(),
                stamps.as_mut_ptr(),
                capacity,
                stamp_capacity,
                timeout,
                &mut code,
            )
        };
        check(code, "pulling samples")?;
        Ok(usize::try_from(values)
            .unwrap_or(usize::MAX)
            .min(rows * width)
            / width)
    }
}

impl Drop for Inlet {
    fn drop(&mut self) {
        // SAFETY: the signature is liblsl's, and this `Inlet` alone owns the handle lsl_create_inlet returned.
        unsafe {
            if let Ok(destroy) = function::<unsafe extern "C" fn(Handle)>("lsl_destroy_inlet") {
                destroy(self.handle);
            }
        }
    }
}

fn cstring(value: &str) -> Result<CString> {
    CString::new(value).map_err(|_| lsl_error(format!("{value:?} holds a NUL byte")))
}

/// Publishes a stream of numbers (one per label) or of text.
pub struct Outlet {
    handle: Handle,
    /// Values per numeric sample; 0 for a text outlet.
    channels: usize,
}

// SAFETY: liblsl's outlets are thread-safe, and this one is pushed from one thread at a time (it is not Sync).
unsafe impl Send for Outlet {}

/// Whether a sample of `values` numbers fits an outlet of `channels` numeric channels (0 for text): liblsl reads
/// exactly `channels` values from the pointer it is given.
fn sample_fits(channels: usize, values: usize) -> Result<()> {
    if channels == 0 {
        return Err(lsl_error("a text outlet publishes text, not numbers"));
    }
    if values != channels {
        return Err(lsl_error(format!(
            "a sample of {values} values for an outlet of {channels} channels"
        )));
    }
    Ok(())
}

impl Outlet {
    /// A numeric outlet `name` of `kind` with one channel per label at `rate` samples per second; with no labels, a
    /// text outlet of one channel at an irregular rate.
    pub fn new(name: &str, kind: &str, labels: &[String], rate: f64) -> Result<Outlet> {
        let (name_c, kind_c, source) = (
            cstring(name)?,
            cstring(kind)?,
            cstring(&format!("ddalab-{name}"))?,
        );
        let labels_c = labels
            .iter()
            .map(|l| cstring(l))
            .collect::<Result<Vec<_>>>()?;
        let count = i32::try_from(labels.len())
            .map_err(|_| lsl_error(format!("{} channels exceed liblsl's limit", labels.len())))?;
        let (count, format, rate) = if labels.is_empty() {
            (1, CFT_STRING, 0.0)
        } else {
            (count, CFT_DOUBLE64, rate)
        };
        // SAFETY: the signatures are liblsl's; the strings outlive the calls, the streaminfo is owned by an `Info`
        // as soon as it is checked, and lsl_create_outlet copies it before the `Info` is dropped.
        unsafe {
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
            let info = Info(non_null(
                create_info(
                    name_c.as_ptr(),
                    kind_c.as_ptr(),
                    count,
                    rate,
                    format,
                    source.as_ptr(),
                ),
                "a stream info",
            )?);
            if !labels_c.is_empty() {
                let channels = append(desc(info.0), c"channels".as_ptr());
                for label_c in &labels_c {
                    append_value(
                        append(channels, c"channel".as_ptr()),
                        c"label".as_ptr(),
                        label_c.as_ptr(),
                    );
                }
            }
            Ok(Outlet {
                handle: non_null(create(info.0, 0, 360), "an outlet")?,
                channels: labels.len(),
            })
        }
    }

    pub fn push(&self, values: &[f64]) -> Result<()> {
        sample_fits(self.channels, values.len())?;
        // SAFETY: lsl_push_sample_d reads `channels` doubles, which `sample_fits` checked `values` holds.
        let code = unsafe {
            let push: Symbol<unsafe extern "C" fn(Handle, *const f64) -> i32> =
                function("lsl_push_sample_d")?;
            push(self.handle, values.as_ptr())
        };
        check(code, "publishing a sample")
    }

    pub fn push_text(&self, value: &str) -> Result<()> {
        if self.channels != 0 {
            return Err(lsl_error("a numeric outlet publishes numbers, not text"));
        }
        let value_c = cstring(value)?;
        let values = [value_c.as_ptr()];
        // SAFETY: lsl_push_sample_str reads one string pointer for this one-channel text outlet; `value_c` outlives
        // the call.
        let code = unsafe {
            let push: Symbol<unsafe extern "C" fn(Handle, *const *const c_char) -> i32> =
                function("lsl_push_sample_str")?;
            push(self.handle, values.as_ptr())
        };
        check(code, "publishing a marker")
    }
}

impl Drop for Outlet {
    fn drop(&mut self) {
        // SAFETY: the signature is liblsl's, and this `Outlet` alone owns the handle lsl_create_outlet returned.
        unsafe {
            if let Ok(destroy) = function::<unsafe extern "C" fn(Handle)>("lsl_destroy_outlet") {
                destroy(self.handle);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_numeric_sample_must_fill_every_channel() {
        assert!(sample_fits(3, 3).is_ok());
        assert!(sample_fits(3, 2).is_err());
        assert!(sample_fits(0, 1).is_err());
    }
}
