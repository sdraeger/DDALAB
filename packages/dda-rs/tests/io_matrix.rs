// A recording held in memory (the Python library's NumPy and MNE input): channels named as given, samples as given.
use dda_rs::io::open_matrix;

#[test]
fn rows_come_back_as_given() {
    // Two channels, three samples, row-major.
    let reader = open_matrix(
        vec!["Fz".into(), "Cz".into()],
        250.0,
        vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0],
    )
    .unwrap();
    let info = reader.info();
    assert_eq!(info.sample_rate_hz, 250.0);
    assert_eq!(info.sample_count, 3);
    assert_eq!(info.analysis_channels(), vec![0, 1]);
    assert_eq!(info.channels[1].label, "Cz");
    assert!(info.input_files.is_empty());
    assert_eq!(
        reader.read_rows(&[1, 0], 1, 2).unwrap(),
        vec![vec![4.0, 3.0], vec![6.0, 5.0]]
    );
}

#[test]
fn a_length_that_is_not_whole_rows_is_refused() {
    let error = open_matrix(vec!["Fz".into(), "Cz".into()], 250.0, vec![1.0, 2.0, 3.0])
        .err()
        .unwrap();
    assert!(error.to_string().contains("3 values"), "{error}");
}

#[test]
fn a_rate_that_is_not_positive_is_refused() {
    assert!(open_matrix(vec!["Fz".into()], 0.0, vec![1.0]).is_err());
}
