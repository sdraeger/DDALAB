#!/usr/bin/env rust-script
//! Progress bar with sliding log window in Rust
//!
//! ```cargo
//! [dependencies]
//! indicatif = "0.17"
//! console = "0.15"
//! ```

use console::style;
use indicatif::{MultiProgress, ProgressBar, ProgressStyle};
use std::collections::VecDeque;
use std::io::{self, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

/// Sliding log window with fixed size
struct SlidingLogger {
    buffer: VecDeque<String>,
    max_lines: usize,
}

impl SlidingLogger {
    fn new(max_lines: usize) -> Self {
        Self {
            buffer: VecDeque::with_capacity(max_lines),
            max_lines,
        }
    }

    fn log(&mut self, message: String) {
        // Add new message
        self.buffer.push_back(message);

        // Remove old messages if over capacity
        while self.buffer.len() > self.max_lines {
            self.buffer.pop_front();
        }
    }

    fn render(&self) -> String {
        let mut output = String::new();

        // Top border
        output.push_str(&format!("╭─ Logs ({}/{}) ─", self.buffer.len(), self.max_lines));
        output.push_str(&"─".repeat(60));
        output.push_str("╮\n");

        // Log messages (pad with empty lines if needed)
        let empty_lines = self.max_lines.saturating_sub(self.buffer.len());

        for _ in 0..empty_lines {
            output.push_str("│");
            output.push_str(&" ".repeat(70));
            output.push_str("│\n");
        }

        for line in &self.buffer {
            output.push_str(&format!("│ {:<68} │\n", line));
        }

        // Bottom border
        output.push_str(&format!("╰{:─<70}╯\n", ""));

        output
    }
}

fn demo_basic_progress() {
    println!("\n{}\n", style("Demo 1: Basic progress with sliding logs").cyan().bold());

    let logger = Arc::new(Mutex::new(SlidingLogger::new(10)));
    let logger_clone = Arc::clone(&logger);

    // Create progress bar
    let pb = ProgressBar::new(100);
    pb.set_style(
        ProgressStyle::default_bar()
            .template("{spinner:.green} [{bar:40.cyan/blue}] {pos}/{len} {msg}")
            .unwrap()
            .progress_chars("#>-"),
    );

    // Simulate work with logging
    for i in 0..100 {
        pb.set_position(i);
        pb.set_message(format!("Processing item {}", i));

        // Add log messages
        if i % 10 == 0 {
            logger_clone
                .lock()
                .unwrap()
                .log(format!("{} Checkpoint {}/100 reached", style("✓").green(), i));
        }
        if i % 23 == 0 {
            logger_clone.lock().unwrap().log(format!(
                "{} Processing batch {}",
                style("⚠").yellow(),
                i / 23 + 1
            ));
        }
        if i % 7 == 0 {
            logger_clone
                .lock()
                .unwrap()
                .log(format!("{}", style(format!("Debug: Processing item {}", i)).dim()));
        }

        // Print log window (clear previous output)
        print!("\x1B[2J\x1B[1;1H"); // Clear screen and move cursor to top
        print!("{}", logger_clone.lock().unwrap().render());
        pb.println("");
        pb.tick();

        thread::sleep(Duration::from_millis(100));
    }

    pb.finish_with_message("Complete!");
    logger_clone
        .lock()
        .unwrap()
        .log(format!("{}", style("✓ Processing complete!").green().bold()));

    print!("\x1B[2J\x1B[1;1H");
    print!("{}", logger_clone.lock().unwrap().render());

    thread::sleep(Duration::from_secs(2));
}

fn demo_with_errors() {
    println!("\n{}\n", style("Demo 2: Progress with errors").cyan().bold());

    let logger = Arc::new(Mutex::new(SlidingLogger::new(8)));
    let logger_clone = Arc::clone(&logger);

    let pb = ProgressBar::new(50);
    pb.set_style(
        ProgressStyle::default_bar()
            .template("{spinner:.green} [{bar:40.cyan/blue}] {pos}/{len} {msg}")
            .unwrap()
            .progress_chars("#>-"),
    );

    for i in 0..50 {
        pb.set_position(i);
        pb.set_message(format!("Processing file {}", i));

        // Simulate different log messages
        if i % 15 == 0 && i > 0 {
            logger_clone.lock().unwrap().log(format!(
                "{} File {} corrupted",
                style("✗ Error:").red().bold(),
                i
            ));
        } else if i % 5 == 0 {
            logger_clone
                .lock()
                .unwrap()
                .log(format!("{} Processed file_{:03}.edf", style("✓").green(), i));
        } else {
            logger_clone.lock().unwrap().log(format!(
                "{}",
                style(format!("→ Reading file_{:03}.edf", i)).dim()
            ));
        }

        print!("\x1B[2J\x1B[1;1H");
        print!("{}", logger_clone.lock().unwrap().render());
        pb.println("");

        thread::sleep(Duration::from_millis(150));
    }

    pb.finish_with_message("Complete!");
    logger_clone
        .lock()
        .unwrap()
        .log(format!("{}", style("✓ All files processed!").green().bold()));

    print!("\x1B[2J\x1B[1;1H");
    print!("{}", logger_clone.lock().unwrap().render());

    thread::sleep(Duration::from_secs(2));
}

fn demo_multi_progress() {
    println!("\n{}\n", style("Demo 3: Multiple progress bars").cyan().bold());

    let logger = Arc::new(Mutex::new(SlidingLogger::new(12)));
    let logger_clone = Arc::clone(&logger);

    let m = MultiProgress::new();

    let pb1 = m.add(ProgressBar::new(100));
    pb1.set_style(
        ProgressStyle::default_bar()
            .template("{prefix:.bold.dim} {spinner:.green} [{bar:30.cyan/blue}] {pos}/{len}")
            .unwrap()
            .progress_chars("#>-"),
    );
    pb1.set_prefix("Download");

    let pb2 = m.add(ProgressBar::new(100));
    pb2.set_style(
        ProgressStyle::default_bar()
            .template("{prefix:.bold.dim} {spinner:.green} [{bar:30.magenta/blue}] {pos}/{len}")
            .unwrap()
            .progress_chars("#>-"),
    );
    pb2.set_prefix("Process ");

    for i in 0..100 {
        // Download is faster
        if i < 100 {
            pb1.set_position((i as f32 * 1.5) as u64);
            if i % 10 == 0 {
                logger_clone
                    .lock()
                    .unwrap()
                    .log(format!("{} Downloaded chunk {}", style("↓").cyan(), i / 10 + 1));
            }
        }

        // Processing is slower
        pb2.set_position(i);
        if i % 15 == 0 {
            logger_clone
                .lock()
                .unwrap()
                .log(format!("{} Processed {} items", style("⚙").magenta(), i));
        }

        print!("\x1B[2J\x1B[1;1H");
        print!("{}", logger_clone.lock().unwrap().render());
        println!();

        thread::sleep(Duration::from_millis(80));
    }

    pb1.finish_with_message("Complete!");
    pb2.finish_with_message("Complete!");

    logger_clone
        .lock()
        .unwrap()
        .log(format!("{}", style("✓ Download complete!").green().bold()));
    logger_clone
        .lock()
        .unwrap()
        .log(format!("{}", style("✓ Processing complete!").green().bold()));

    print!("\x1B[2J\x1B[1;1H");
    print!("{}", logger_clone.lock().unwrap().render());

    thread::sleep(Duration::from_secs(2));
}

fn main() {
    println!("\n{}\n", style("Progress Bars with Sliding Logs").bold().underlined());

    demo_basic_progress();
    demo_with_errors();
    demo_multi_progress();

    println!("\n{}\n", style("✓ All demos complete!").green().bold());
}
