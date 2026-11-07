//! The metadata of a recording that the user may edit, and the edited copy: the files to write as new header bytes,
//! byte ranges of the original files and the stored samples. The original files are never written.
//! EDF and BDF keep their format (edf.rs), as do BrainVision (brainvision.rs) and text recordings (ascii.rs); an
//! EEGLAB dataset becomes a BrainVision copy of its float32 samples. A BIDS `_channels.tsv` beside the recording comes
//! along with the edited names and units.

use super::{ascii, brainvision, edf, open_eeglab, FileSet, Format};
use crate::error::{DDAError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// One editable value: a recording field, or a column of the channel table (whose `value` is empty).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Field {
    pub key: String,
    pub name: String,
    pub value: String,
    /// The most characters the format stores.
    pub max: Option<usize>,
    /// Printable ASCII only.
    pub ascii: bool,
}

/// The values of one channel's columns; `index` counts in `RecordingInfo::channels`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Channel {
    pub index: usize,
    pub values: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Metadata {
    /// The format of the copy: the recording's own, or BrainVision for an EEGLAB dataset.
    pub writes_as: String,
    pub fields: Vec<Field>,
    pub columns: Vec<Field>,
    pub channels: Vec<Channel>,
    /// What the copy leaves out or changes beyond the edits.
    pub notes: Vec<String>,
}

/// A run of an output file's bytes.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Part {
    Bytes {
        bytes: Vec<u8>,
    },
    /// Bytes `start..end` of input file `file`.
    Slice {
        file: String,
        start: u64,
        end: u64,
    },
    /// Rows `0..rows` of the display channels' stored samples, as little-endian float32, channel by channel within
    /// each row: what `Reader::read_raw_f32` gives for `RecordingInfo::analysis_channels`.
    Samples {
        rows: u64,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct OutFile {
    pub name: String,
    pub parts: Vec<Part>,
}

pub(super) fn field(key: &str, name: &str, value: &str, max: Option<usize>, ascii: bool) -> Field {
    Field {
        key: key.to_string(),
        name: name.to_string(),
        value: value.to_string(),
        max,
        ascii,
    }
}

pub(super) fn invalid(message: String) -> DDAError {
    DDAError::InvalidParameter(message)
}

/// `name` without its directory, `-edited` before its extension.
pub(super) fn copy_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    match base.rsplit_once('.') {
        Some((stem, extension)) => format!("{stem}-edited.{extension}"),
        None => format!("{base}-edited"),
    }
}

/// The editable metadata of the recording `files.primary` names.
pub fn metadata(files: &FileSet) -> Result<Metadata> {
    let name = files.primary.as_str();
    match Format::require(name)? {
        Format::Edf => edf::metadata(files, name),
        Format::BrainVision => brainvision::metadata(files, name),
        Format::Eeglab => eeglab_metadata(files, name),
        Format::Text => ascii::metadata(files, name),
    }
}

/// The files of the copy with `edited` (which `metadata` gave, values changed) applied.
pub fn edit(files: &FileSet, edited: &Metadata) -> Result<Vec<OutFile>> {
    let original = metadata(files)?;
    check(&original, edited)?;
    let name = files.primary.as_str();
    let mut out = match Format::require(name)? {
        Format::Edf => edf::edited(files, name, edited)?,
        Format::BrainVision => brainvision::edited(files, name, edited)?,
        Format::Eeglab => eeglab_edited(files, name, edited)?,
        Format::Text => ascii::edited(files, name, edited)?,
    };
    out.extend(channels_tsv(files, &original, edited));
    Ok(out)
}

/// The value of column `key` for every channel of `metadata`, in its order.
pub(super) fn column<'a>(metadata: &'a Metadata, key: &str) -> Vec<&'a str> {
    let Some(c) = metadata.columns.iter().position(|f| f.key == key) else {
        return Vec::new();
    };
    metadata
        .channels
        .iter()
        .map(|ch| ch.values[c].as_str())
        .collect()
}

pub(super) fn value<'a>(metadata: &'a Metadata, key: &str) -> &'a str {
    metadata
        .fields
        .iter()
        .find(|f| f.key == key)
        .map_or("", |f| f.value.as_str())
}

/// Refuses an edit that is not of `original`'s shape, a value its field cannot hold, and empty or repeated labels.
fn check(original: &Metadata, edited: &Metadata) -> Result<()> {
    let keys = |fields: &[Field]| fields.iter().map(|f| f.key.clone()).collect::<Vec<_>>();
    let indices = |m: &Metadata| m.channels.iter().map(|c| c.index).collect::<Vec<_>>();
    if keys(&original.fields) != keys(&edited.fields)
        || keys(&original.columns) != keys(&edited.columns)
        || indices(original) != indices(edited)
        || edited
            .channels
            .iter()
            .any(|c| c.values.len() != original.columns.len())
    {
        return Err(invalid(
            "the edited metadata does not match the recording's fields and channels".to_string(),
        ));
    }
    let mut problems = Vec::new();
    let mut fits = |spec: &Field, value: &str, what: String| {
        if spec.max.is_some_and(|max| value.chars().count() > max) {
            problems.push(format!(
                "{what} is longer than {} characters",
                spec.max.unwrap_or(0)
            ));
        }
        if value.chars().any(char::is_control) {
            problems.push(format!("{what} holds a line break or tab"));
        } else if spec.ascii && !value.chars().all(|c| c.is_ascii_graphic() || c == ' ') {
            problems.push(format!("{what} holds characters outside ASCII"));
        }
    };
    for (spec, field) in original.fields.iter().zip(&edited.fields) {
        fits(spec, &field.value, spec.name.clone());
    }
    for channel in &edited.channels {
        for (spec, value) in original.columns.iter().zip(&channel.values) {
            fits(
                spec,
                value,
                format!("{} of channel {}", spec.name, channel.index + 1),
            );
        }
    }
    let labels = column(edited, "label");
    if labels.iter().any(|l| l.trim().is_empty()) {
        problems.push("a channel has no label".to_string());
    }
    let mut seen = HashSet::new();
    if let Some(repeated) = labels.iter().find(|l| !seen.insert(l.trim())) {
        problems.push(format!("the label {repeated} is used twice"));
    }
    match problems.is_empty() {
        true => Ok(()),
        false => Err(invalid(problems.join("; "))),
    }
}

/// An EEGLAB dataset's display channels, which its BrainVision copy holds: label and unit, the unit as BrainVision
/// writes it (microvolts for volts).
fn eeglab_metadata(files: &FileSet, name: &str) -> Result<Metadata> {
    let reader = open_eeglab(files, name)?;
    let info = reader.info();
    let analysis = info.analysis_channels();
    let mut notes = vec!["An EEGLAB dataset is saved as a BrainVision copy (.vhdr, .eeg, .vmrk) of its float32 samples and events.".to_string()];
    let left = info.channels.len() - analysis.len();
    if left > 0 {
        notes.push(format!(
            "{left} channels at another rate or of another kind are left out."
        ));
    }
    Ok(Metadata {
        writes_as: "BrainVision".to_string(),
        fields: Vec::new(),
        columns: vec![
            field("label", "Label", "", None, false),
            field("unit", "Unit", "", None, false),
        ],
        channels: analysis
            .iter()
            .map(|&i| {
                let channel = &info.channels[i];
                let unit = if channel.unit == "V" {
                    "µV"
                } else {
                    &channel.unit
                };
                Channel {
                    index: i,
                    values: vec![channel.label.clone(), unit.to_string()],
                }
            })
            .collect(),
        notes,
    })
}

fn eeglab_edited(files: &FileSet, name: &str, edited: &Metadata) -> Result<Vec<OutFile>> {
    let reader = open_eeglab(files, name)?;
    let info = reader.info();
    let (annotations, _) = reader.scan_annotations()?;
    let stem = copy_name(name)
        .trim_end_matches(".set")
        .trim_end_matches(".SET")
        .to_string();
    let channels: Vec<(String, f64, String)> = edited
        .channels
        .iter()
        .map(|c| {
            let channel = &info.channels[c.index];
            // The stored float32 times the resolution is the value in the header's unit: microvolts for volts.
            let resolution = if channel.unit == "V" {
                channel.gain * 1e6
            } else {
                channel.gain
            };
            (c.values[0].clone(), resolution, c.values[1].clone())
        })
        .collect();
    let (vhdr, vmrk) = brainvision::write_headers(
        &stem,
        info.sample_rate_hz,
        &channels,
        &annotations,
        &format!("converted by DDALAB from {name}"),
    );
    Ok(vec![
        OutFile {
            name: format!("{stem}.vhdr"),
            parts: vec![Part::Bytes { bytes: vhdr }],
        },
        OutFile {
            name: format!("{stem}.eeg"),
            parts: vec![Part::Samples {
                rows: info.sample_count,
            }],
        },
        OutFile {
            name: format!("{stem}.vmrk"),
            parts: vec![Part::Bytes { bytes: vmrk }],
        },
    ])
}

/// The BIDS `_channels.tsv` beside the recording with the edited labels (and units, when the copy has a unit
/// column) in the rows of the original labels; `None` without one or without a change.
fn channels_tsv(files: &FileSet, original: &Metadata, edited: &Metadata) -> Option<OutFile> {
    let [name, _, _] = FileSet::sidecar_names(&files.primary)?;
    let source = files.source(&name)?;
    let mut bytes = vec![0u8; source.len() as usize];
    source.read_at(0, &mut bytes).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    let (old, new) = (column(original, "label"), column(edited, "label"));
    let units = column(edited, "unit");
    if old == new && column(original, "unit") == units {
        return None;
    }
    let mut lines = text.split_inclusive('\n');
    let header = lines.next()?;
    let columns: Vec<&str> = header.trim_end().split('\t').map(str::trim).collect();
    let name_column = columns
        .iter()
        .position(|c| c.trim_start_matches('\u{feff}') == "name")?;
    let units_column = columns.iter().position(|&c| c == "units");
    let mut out = header.to_string();
    for line in lines {
        let ending = &line[line.trim_end_matches(['\r', '\n']).len()..];
        let mut cells: Vec<String> = line
            .trim_end_matches(['\r', '\n'])
            .split('\t')
            .map(str::to_string)
            .collect();
        if let Some(k) = cells
            .get(name_column)
            .and_then(|cell| old.iter().position(|o| o == cell))
        {
            cells[name_column] = new[k].to_string();
            if let (Some(u), Some(unit)) = (units_column, units.get(k)) {
                if u < cells.len() {
                    cells[u] = unit.to_string();
                }
            }
        }
        out.push_str(&cells.join("\t"));
        out.push_str(ending);
    }
    Some(OutFile {
        name,
        parts: vec![Part::Bytes {
            bytes: out.into_bytes(),
        }],
    })
}
