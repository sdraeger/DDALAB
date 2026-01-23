#!/usr/bin/env rust-script
//! Advanced TUI with progress and sliding logs using ratatui
//!
//! ```cargo
//! [dependencies]
//! ratatui = "0.25"
//! crossterm = "0.27"
//! ```

use crossterm::{
    event::{self, Event, KeyCode},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Gauge, List, ListItem, Paragraph},
    Terminal,
};
use std::collections::VecDeque;
use std::io;
use std::time::{Duration, Instant};

struct SlidingLogger {
    messages: VecDeque<String>,
    max_lines: usize,
}

impl SlidingLogger {
    fn new(max_lines: usize) -> Self {
        Self {
            messages: VecDeque::with_capacity(max_lines),
            max_lines,
        }
    }

    fn log(&mut self, message: String) {
        self.messages.push_back(message);
        while self.messages.len() > self.max_lines {
            self.messages.pop_front();
        }
    }

    fn as_list_items(&self) -> Vec<ListItem> {
        self.messages
            .iter()
            .map(|msg| {
                // Parse styled messages (simple color parsing)
                let line = if msg.contains("✓") {
                    Line::from(vec![
                        Span::styled("✓ ", Style::default().fg(Color::Green)),
                        Span::raw(msg.replace("✓ ", "")),
                    ])
                } else if msg.contains("✗") {
                    Line::from(vec![
                        Span::styled("✗ ", Style::default().fg(Color::Red)),
                        Span::raw(msg.replace("✗ ", "")),
                    ])
                } else if msg.contains("⚠") {
                    Line::from(vec![
                        Span::styled("⚠ ", Style::default().fg(Color::Yellow)),
                        Span::raw(msg.replace("⚠ ", "")),
                    ])
                } else if msg.starts_with("Debug:") {
                    Line::from(Span::styled(msg, Style::default().fg(Color::DarkGray)))
                } else {
                    Line::from(msg.as_str())
                };

                ListItem::new(line)
            })
            .collect()
    }
}

struct App {
    progress: u16,
    logger: SlidingLogger,
    running: bool,
}

impl App {
    fn new() -> Self {
        Self {
            progress: 0,
            logger: SlidingLogger::new(15),
            running: true,
        }
    }

    fn update(&mut self) {
        if self.progress < 100 {
            self.progress += 1;

            // Add various log messages
            if self.progress % 10 == 0 {
                self.logger.log(format!("✓ Checkpoint {}/100 reached", self.progress));
            }
            if self.progress % 23 == 0 {
                self.logger.log(format!("⚠ Processing batch {}", self.progress / 23 + 1));
            }
            if self.progress % 7 == 0 {
                self.logger
                    .log(format!("Debug: Processing item {}", self.progress));
            }
            if self.progress % 15 == 0 && self.progress % 30 != 0 {
                self.logger.log(format!("✗ Error in item {}", self.progress));
            }
        } else {
            self.logger.log("✓ Processing complete!".to_string());
            self.running = false;
        }
    }
}

fn main() -> Result<(), io::Error> {
    // Setup terminal
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    // Create app
    let mut app = App::new();
    let tick_rate = Duration::from_millis(100);
    let mut last_tick = Instant::now();

    // Main loop
    loop {
        // Draw UI
        terminal.draw(|f| {
            // Create layout
            let chunks = Layout::default()
                .direction(Direction::Vertical)
                .constraints([
                    Constraint::Length(3),  // Progress bar
                    Constraint::Min(10),    // Logs
                    Constraint::Length(3),  // Instructions
                ])
                .split(f.size());

            // Progress bar
            let progress_percent = app.progress;
            let gauge = Gauge::default()
                .block(
                    Block::default()
                        .title("Progress")
                        .borders(Borders::ALL)
                        .border_style(Style::default().fg(Color::Cyan)),
                )
                .gauge_style(
                    Style::default()
                        .fg(Color::Cyan)
                        .bg(Color::Black)
                        .add_modifier(Modifier::BOLD),
                )
                .percent(progress_percent)
                .label(format!("{}/100", progress_percent));

            f.render_widget(gauge, chunks[0]);

            // Log window
            let logs = List::new(app.logger.as_list_items())
                .block(
                    Block::default()
                        .title(format!(
                            "Logs ({}/{})",
                            app.logger.messages.len(),
                            app.logger.max_lines
                        ))
                        .borders(Borders::ALL)
                        .border_style(Style::default().fg(Color::Cyan)),
                )
                .style(Style::default().fg(Color::White));

            f.render_widget(logs, chunks[1]);

            // Instructions
            let instructions = Paragraph::new("Press 'q' to quit • Space to pause/resume")
                .block(
                    Block::default()
                        .borders(Borders::ALL)
                        .border_style(Style::default().fg(Color::DarkGray)),
                )
                .style(Style::default().fg(Color::DarkGray));

            f.render_widget(instructions, chunks[2]);
        })?;

        // Handle events
        let timeout = tick_rate.saturating_sub(last_tick.elapsed());
        if crossterm::event::poll(timeout)? {
            if let Event::Key(key) = event::read()? {
                match key.code {
                    KeyCode::Char('q') => break,
                    KeyCode::Char(' ') => {
                        app.running = !app.running;
                    }
                    _ => {}
                }
            }
        }

        // Update app state
        if last_tick.elapsed() >= tick_rate {
            if app.running {
                app.update();
            }
            last_tick = Instant::now();
        }

        // Exit when complete
        if !app.running && app.progress >= 100 {
            std::thread::sleep(Duration::from_secs(2));
            break;
        }
    }

    // Restore terminal
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    Ok(())
}
