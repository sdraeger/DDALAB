// `ddalab stream` on a live LSL stream this test publishes. Skipped where liblsl is not installed (DDALAB_LIBLSL).
use dda_rs::lsl::Outlet;
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::process::Stdio;
use std::time::{Duration, Instant};

/// Publishes two channels of sines at 256 Hz as stream `name` until the returned flag is set.
fn publish(name: &str) -> Option<std::sync::Arc<std::sync::atomic::AtomicBool>> {
    let outlet = match Outlet::new(name, "EEG", &["A".to_string(), "B".to_string()], 256.0) {
        Ok(outlet) => outlet,
        Err(e) => {
            eprintln!("skipped: {e}");
            return None;
        }
    };
    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stopped = stop.clone();
    std::thread::spawn(move || {
        let start = Instant::now();
        let mut i = 0u64;
        while !stopped.load(std::sync::atomic::Ordering::Relaxed) {
            // Keep up with the clock, a few samples at a time.
            while (i as f64) < start.elapsed().as_secs_f64() * 256.0 {
                let t = i as f64 / 256.0;
                let s = (2.0 * std::f64::consts::PI * 7.0 * t).sin();
                outlet.push(&[s + 0.1 * (t * 13.0).sin(), 0.5 * s]).unwrap();
                i += 1;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    });
    Some(stop)
}

#[test]
fn a_live_stream_gives_a_result_every_step() {
    let name = format!("ddalab-test-{}", std::process::id());
    let Some(stop) = publish(&name) else { return };
    let mut child = std::process::Command::new(env!("CARGO_BIN_EXE_ddalab"))
        .args([
            "stream",
            "--stream",
            &name,
            "--reference",
            "average",
            "--wl",
            "256",
            "--ws",
            "128",
            "--duration",
            "3",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let lines: Vec<Value> = BufReader::new(child.stdout.take().unwrap())
        .lines()
        .map(|l| serde_json::from_str(&l.unwrap()).unwrap())
        .collect();
    let status = child.wait().unwrap();
    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    assert!(
        status.success(),
        "{}",
        std::io::read_to_string(child.stderr.take().unwrap()).unwrap()
    );
    // 3 s at 256 Hz is 768 samples: a result every 128 once the first window of 256 (and its reach) is in.
    assert!((3..=5).contains(&lines.len()), "{lines:?}");
    let st = lines[0]["variants"]["ST"].as_array().unwrap();
    assert_eq!(st.len(), 2, "a value per referenced channel");
    assert!(st.iter().all(|v| v.as_f64().unwrap().is_finite()));
}

#[test]
fn a_silent_connection_does_not_block_the_web_app() {
    let name = format!("ddalab-serve-{}", std::process::id());
    let Some(stop) = publish(&name) else { return };
    let port = 30000 + (std::process::id() % 20000) as u16;
    let mut child = std::process::Command::new(env!("CARGO_BIN_EXE_ddalab"))
        .args([
            "stream",
            "--stream",
            &name,
            "--serve",
            &port.to_string(),
            "--quiet",
            "--duration",
            "8",
        ])
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    // The address it prints, with the token.
    let address = BufReader::new(child.stderr.take().unwrap())
        .lines()
        .map_while(Result::ok)
        .find_map(|line| {
            line.split_once("Serving the web app at ")
                .map(|(_, a)| a.to_string())
        })
        .expect("the stream prints its address");
    let _silent = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
    let started = Instant::now();
    let (mut socket, _) = tungstenite::connect(&address).unwrap();
    let header: Value = serde_json::from_str(socket.read().unwrap().to_text().unwrap()).unwrap();
    assert_eq!(header["type"], "header");
    assert!(
        started.elapsed() < Duration::from_secs(3),
        "{:?}",
        started.elapsed()
    );
    let refused = tungstenite::connect(format!("ws://127.0.0.1:{port}/?token=wrong"));
    assert!(refused.is_err(), "a wrong token is refused");
    child.kill().unwrap();
    child.wait().unwrap();
    stop.store(true, std::sync::atomic::Ordering::Relaxed);
}
