// The released binary: the same command line as `dda_rs::cli`, named and versioned as DDALAB.
use std::process::Command;

#[test]
fn version_names_ddalab() {
    let output = Command::new(env!("CARGO_BIN_EXE_ddalab")).arg("--version").output().unwrap();
    assert!(output.status.success());
    let expected = format!("ddalab {}\n", env!("CARGO_PKG_VERSION"));
    assert_eq!(String::from_utf8_lossy(&output.stdout), expected);
}

#[test]
fn a_usage_error_exits_with_two() {
    let status = Command::new(env!("CARGO_BIN_EXE_ddalab")).arg("frobnicate").status().unwrap();
    assert_eq!(status.code(), Some(2));
}
