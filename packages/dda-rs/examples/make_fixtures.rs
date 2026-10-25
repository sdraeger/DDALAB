//! Writes `tests/fixtures` (`cargo run --example make_fixtures`), or with `--large <dir> <channels>...` a 1 h,
//! 1 kHz EDF per channel count, `<dir>/large_<channels>ch.edf`, for the wasm pool benchmark.

#[path = "../tests/support/mod.rs"]
mod support;

use std::path::Path;
use support::{edf_bytes, write_fixtures, EdfSpec};

fn main() -> std::io::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some((dir, counts)) = args
        .split_first()
        .filter(|(flag, _)| *flag == "--large")
        .and_then(|(_, rest)| rest.split_first())
    else {
        return write_fixtures(&Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures"));
    };
    for count in counts {
        let channels: usize = count.parse().expect("--large <dir> <channels>...");
        let spec = EdfSpec {
            labels: (1..=channels).map(|c| format!("C{c:03}")).collect(),
            units: vec!["uV".into(); channels],
            rates_per_record: vec![1000; channels],
            records: 3600,
            seed: 99,
            ..EdfSpec::default()
        };
        let path = Path::new(dir).join(format!("large_{channels}ch.edf"));
        std::fs::write(path, edf_bytes(&spec))?;
    }
    Ok(())
}
