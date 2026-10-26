mod support;

/// `tests/fixtures` holds exactly what `cargo run --example make_fixtures` writes.
#[test]
fn fixtures_are_reproducible() {
    let dir = tempfile::tempdir().unwrap();
    support::write_fixtures(dir.path()).unwrap();
    let committed = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    for (name, _) in support::fixture_files() {
        let written = std::fs::read(dir.path().join(&name)).unwrap();
        let on_disk = std::fs::read(committed.join(&name))
            .unwrap_or_else(|e| panic!("{name}: {e}; run `cargo run --example make_fixtures`"));
        assert!(
            written == on_disk,
            "{name} differs from what make_fixtures writes"
        );
    }
}
