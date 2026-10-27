// The CLI as a library function, which the ddalab binary and the Python wheel's console script both call: it returns
// the exit code instead of ending the process, also for clap's own exits.
use dda_rs::cli::main_with_args;

#[test]
fn an_unknown_command_returns_the_usage_code() {
    assert_eq!(main_with_args(["ddalab", "frobnicate"]), 2);
}

#[test]
fn version_returns_zero() {
    assert_eq!(main_with_args(["ddalab", "--version"]), 0);
}

#[test]
fn a_missing_file_returns_the_input_error_code() {
    assert_eq!(
        main_with_args(["ddalab", "validate", "--file", "/nonexistent/recording.edf"]),
        dda_rs::cli::exit_codes::INPUT_ERROR
    );
}
