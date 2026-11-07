//! The clock the engine throttles progress by; wasm32 has none.

#[cfg(not(target_arch = "wasm32"))]
pub(crate) use std::time::Instant;

// shortcut: wasm32-unknown-unknown has no clock (elapsed() is always MAX, the engine never throttles progress by time and the host throttles by step count), add a host clock import when the browser needs timed progress or profiling
#[cfg(target_arch = "wasm32")]
pub(crate) use no_clock::Instant;

#[cfg(target_arch = "wasm32")]
mod no_clock {
    use std::time::Duration;

    #[derive(Clone, Copy)]
    pub struct Instant;

    impl Instant {
        pub fn now() -> Self {
            Self
        }
        pub fn elapsed(&self) -> Duration {
            Duration::MAX
        }
    }

    impl std::ops::Sub<Duration> for Instant {
        type Output = Self;
        fn sub(self, _: Duration) -> Self {
            self
        }
    }
}
