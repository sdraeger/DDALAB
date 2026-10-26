//! The ASCII reader against the branches of `readers/delimited.py` (the NumPy-free observable behavior is ported):
//!
//! - delimiter: `.csv` splits on commas, other files on whitespace. This reader also detects tab, semicolon and
//!   comma from the first line (`comma_with_header`, `tab_headerless`, `whitespace_headerless`, `semicolon_with_header`)
//! - blank lines, `#` lines (as `input_io` skips them), a byte order mark and CRLF are dropped
//!   (`bom_crlf_and_blank_lines`, `headerless_matches_input_io`)
//! - the first line is a header when a cell is not a number (`comma_with_header`; `empty_cell_in_first_row_is_data`
//!   differs from Python, which reads an empty cell as text)
//! - a header with fewer labels than columns gives default names (`short_header_gives_default_names`);
//!   empty and repeated labels are named and suffixed (`empty_and_repeated_labels`)
//! - lines without a number are skipped; rows are cut or padded to the most common width; empty or
//!   non-numeric cells are NaN, each with a warning (`ragged_rows_and_gaps_warn`)
//! - a first column named like time is the time axis, and only the header names it (`leading_time_column_sets_rate`,
//!   `time_header_names_the_time_column`, `timeline_is_not_a_time_header`, `headerless_ramp_is_kept`)
//! - the rate is 1 / the mean positive time step; Python's 1 Hz fallback is a warning here, and a given rate
//!   wins (`argument_rate_wins_over_time_column`, `no_rate_warns`)
//! - an empty file, no numeric line, or no channel besides time is an error (`bad_input_is_refused`)

use dda_rs::input_io::load_ascii_matrix_from_path;
use dda_rs::io::{open_ascii, ByteSource, ChannelKind, FileSet, MemorySource, RawType, Reader};
use std::sync::Arc;

fn file_set(name: &str, bytes: &[u8]) -> FileSet {
    FileSet {
        primary: name.to_string(),
        files: [(
            name.to_string(),
            Arc::new(MemorySource(bytes.to_vec())) as Arc<dyn ByteSource>,
        )]
        .into(),
    }
}

fn open(name: &str, text: &str, rate: Option<f64>) -> Box<dyn Reader> {
    open_ascii(&file_set(name, text.as_bytes()), name, rate).unwrap()
}

fn open_error(text: &str, rate: Option<f64>) -> String {
    open_ascii(&file_set("x.txt", text.as_bytes()), "x.txt", rate)
        .err()
        .expect("open should fail")
        .to_string()
}

fn labels(reader: &dyn Reader) -> Vec<&str> {
    reader
        .info()
        .channels
        .iter()
        .map(|c| c.label.as_str())
        .collect()
}

fn all_rows(reader: &dyn Reader) -> Vec<Vec<f64>> {
    let info = reader.info();
    let channels: Vec<usize> = (0..info.channels.len()).collect();
    reader
        .read_rows(&channels, 0, info.sample_count as usize)
        .unwrap()
}

#[test]
fn comma_with_header() {
    let reader = open("a.csv", "Fp1,Fp2\n1.5,2.5\n-3,4e-1\n", Some(250.0));
    let info = reader.info();
    assert_eq!(info.format, "CSV");
    assert_eq!(labels(&*reader), ["Fp1", "Fp2"]);
    assert_eq!(all_rows(&*reader), [[1.5, 2.5], [-3.0, 0.4]]);
    assert_eq!(info.sample_rate_hz, 250.0);
    assert_eq!(info.sample_count, 2);
    assert_eq!(info.duration_s, 2.0 / 250.0);
    assert_eq!(info.raw_type, RawType::F64);
    assert_eq!(info.input_files, ["a.csv"]);
    assert!(info.annotations.is_empty() && info.warnings.is_empty());
    assert_eq!(info.analysis_channels(), [0, 1]);
    for channel in &info.channels {
        assert_eq!(
            (channel.unit.as_str(), channel.gain, channel.offset),
            ("", 1.0, 0.0)
        );
        assert_eq!(channel.kind, ChannelKind::Signal);
        assert_eq!(channel.sample_rate_hz, 250.0);
    }
}

#[test]
fn tab_headerless() {
    let reader = open("a.tsv", "1\t2\t3\n4\t5\t6\n9\t8\t7\n", Some(100.0));
    assert_eq!(reader.info().format, "ASCII");
    assert_eq!(labels(&*reader), ["Channel 1", "Channel 2", "Channel 3"]);
    assert_eq!(
        all_rows(&*reader),
        [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0], [9.0, 8.0, 7.0]]
    );
}

#[test]
fn whitespace_headerless() {
    let reader = open("a.txt", "  0.5   -1.5 \n2.5 3\n7\t1e2\n", Some(100.0));
    assert_eq!(labels(&*reader), ["Channel 1", "Channel 2"]);
    assert_eq!(all_rows(&*reader), [[0.5, -1.5], [2.5, 3.0], [7.0, 100.0]]);
}

#[test]
fn semicolon_with_header() {
    let reader = open("a.txt", "Fp1 (uV);Fz\n1;2\n3;5\n8;13\n", Some(100.0));
    assert_eq!(labels(&*reader), ["Fp1 (uV)", "Fz"]);
    assert_eq!(all_rows(&*reader), [[1.0, 2.0], [3.0, 5.0], [8.0, 13.0]]);
}

#[test]
fn leading_time_column_sets_rate() {
    let reader = open(
        "a.txt",
        "time a b\n0 10 11\n0.002 12 13\n0.004 14 15\n",
        None,
    );
    let info = reader.info();
    assert!((info.sample_rate_hz - 500.0).abs() < 1e-9);
    assert!((info.duration_s - 3.0 / 500.0).abs() < 1e-12);
    assert_eq!(labels(&*reader), ["a", "b"]);
    assert_eq!(
        all_rows(&*reader),
        [[10.0, 11.0], [12.0, 13.0], [14.0, 15.0]]
    );
    assert!(info.warnings.is_empty());
}

#[test]
fn headerless_ramp_is_kept() {
    let reader = open("a.txt", "0 10\n0.002 12\n0.004 14\n", Some(500.0));
    assert_eq!(labels(&*reader), ["Channel 1", "Channel 2"]);
    assert_eq!(
        all_rows(&*reader),
        [[0.0, 10.0], [0.002, 12.0], [0.004, 14.0]]
    );
}

#[test]
fn time_header_names_the_time_column() {
    // Steps of 4.1, 3.8 and 4.1 ms: the rate is 1 / their mean.
    let reader = open(
        "a.csv",
        "Time (s),Fp1\n0,1\n0.0041,2\n0.0079,5\n0.012,3\n",
        None,
    );
    assert!((reader.info().sample_rate_hz - 250.0).abs() < 1e-9);
    assert_eq!(labels(&*reader), ["Fp1"]);
    assert_eq!(all_rows(&*reader), [[1.0], [2.0], [5.0], [3.0]]);
}

#[test]
fn timeline_is_not_a_time_header() {
    let reader = open("a.csv", "Timeline,Fp1\n5,1\n3,2\n", Some(10.0));
    assert_eq!(labels(&*reader), ["Timeline", "Fp1"]);
}

#[test]
fn argument_rate_wins_over_time_column() {
    let reader = open("a.txt", "time a\n0 10\n0.002 12\n0.004 14\n", Some(1000.0));
    assert_eq!(reader.info().sample_rate_hz, 1000.0);
    assert_eq!(labels(&*reader), ["a"]);
    assert!(reader.info().warnings.is_empty());
}

#[test]
fn no_rate_warns() {
    let reader = open("a.txt", "1 2\n4 5\n9 3\n", None);
    let info = reader.info();
    assert_eq!(info.sample_rate_hz, 1.0);
    assert_eq!(info.duration_s, 3.0);
    assert_eq!(info.warnings.len(), 1);
    assert!(info.warnings[0].contains("sample rate"));
}

#[test]
fn headerless_matches_input_io() {
    let text = "# recorded 2026\n0.5 -1.5 1e-3\n 2.5 3 4.25\n\n  # gap\n7 100 -8\n";
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("a.txt");
    std::fs::write(&path, text).unwrap();
    assert_eq!(
        all_rows(&*open("a.txt", text, Some(100.0))),
        load_ascii_matrix_from_path(&path).unwrap()
    );
}

#[test]
fn bom_crlf_and_blank_lines() {
    let bytes = b"\xEF\xBB\xBFFp1,Fp2\r\n\r\n1,2\r\n3,4\r\n  \r\n";
    let reader = open_ascii(&file_set("a.csv", bytes), "a.csv", Some(100.0)).unwrap();
    assert_eq!(labels(&*reader), ["Fp1", "Fp2"]);
    assert_eq!(all_rows(&*reader), [[1.0, 2.0], [3.0, 4.0]]);
}

#[test]
fn short_header_gives_default_names() {
    let reader = open("a.csv", "a,b\n1,2,3\n4,5,6\n", Some(100.0));
    assert_eq!(labels(&*reader), ["Channel 1", "Channel 2", "Channel 3"]);
}

#[test]
fn empty_and_repeated_labels() {
    let reader = open("a.csv", "A,A,,A\n1,2,3,4\n2,3,4,5\n4,5,6,7\n", Some(100.0));
    assert_eq!(labels(&*reader), ["A", "A-2", "Channel 3", "A-3"]);
}

#[test]
fn ragged_rows_and_gaps_warn() {
    let reader = open(
        "a.csv",
        "1,2,3\n4,5\n6,,8\nx,y,z\n9,10,11,12\n",
        Some(100.0),
    );
    let rows = all_rows(&*reader);
    assert_eq!(rows.len(), 4);
    assert_eq!(rows[0], [1.0, 2.0, 3.0]);
    assert!(rows[1][2].is_nan() && rows[2][1].is_nan());
    assert_eq!((rows[1][..2].to_vec(), rows[2][2]), (vec![4.0, 5.0], 8.0));
    assert_eq!(rows[3], [9.0, 10.0, 11.0]);
    assert_eq!(
        reader.info().warnings,
        [
            "1 text-only lines were skipped.",
            "2 rows do not have 3 columns; they were padded or cut.",
            "2 empty or non-numeric cells are treated as gaps (NaN)."
        ]
    );
}

#[test]
fn empty_cell_in_first_row_is_data() {
    let reader = open("a.csv", "1,,3\n4,5,6\n9,8,7\n", Some(100.0));
    assert_eq!(labels(&*reader), ["Channel 1", "Channel 2", "Channel 3"]);
    let rows = all_rows(&*reader);
    assert_eq!(rows.len(), 3);
    assert!(rows[0][1].is_nan());
}

#[test]
fn bad_input_is_refused() {
    assert!(open_error("", Some(1.0)).contains("empty"));
    assert!(open_error(" \n\r\n", Some(1.0)).contains("empty"));
    assert!(open_error("a,b\nc,d\n", Some(1.0)).contains("No numeric samples"));
    assert!(open_error("time\n0\n1\n2\n", Some(1.0)).contains("signal channel"));
    assert!(open_error("1 2\n", Some(0.0)).contains("sample rate"));
    assert!(open_error("1 2\n", Some(f64::NAN)).contains("sample rate"));
    let missing = open_ascii(&file_set("a.txt", b"1 2\n"), "b.txt", None)
        .err()
        .unwrap();
    assert!(missing.to_string().contains("b.txt"));
}

#[test]
fn reads_check_their_arguments() {
    let reader = open("a.txt", "1 2\n4 5\n9 3\n", Some(100.0));
    assert_eq!(reader.read_rows(&[1], 1, 2).unwrap(), [[5.0], [3.0]]);
    let mut out = [0f32; 4];
    reader.read_raw_f32(&[1, 0], 2, 1, &mut out[..2]).unwrap();
    assert_eq!(out[..2], [3.0, 9.0]);
    assert!(reader.read_rows(&[], 0, 1).is_err());
    assert!(reader.read_rows(&[2], 0, 1).is_err());
    assert!(reader.read_rows(&[0], 2, 2).is_err());
    assert!(reader.read_rows(&[0], u64::MAX, 2).is_err());
    assert!(reader.read_rows(&[0], 0, usize::MAX).is_err());
    assert!(reader.read_raw_f32(&[0], 0, 2, &mut out[..1]).is_err());
}
