// Lock-free circular buffer for streaming data
//
// Provides high-performance buffering of data chunks and DDA results with
// configurable overflow strategies and metrics tracking.

use crate::streaming::source::DataChunk;
use crossbeam::queue::ArrayQueue;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;

/// Strategy for handling buffer overflow
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum OverflowStrategy {
    /// Drop oldest items (ring buffer behavior) - best for real-time
    DropOldest,

    /// Drop newest items (backpressure) - preserves historical data
    DropNewest,

    /// Block until space available (not recommended for real-time)
    Block,
}

/// Metrics for buffer performance monitoring
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BufferMetrics {
    pub total_pushed: u64,
    pub total_popped: u64,
    pub total_dropped: u64,
    pub current_size: usize,
    pub peak_size: usize,
    pub capacity: usize,
}

impl Default for BufferMetrics {
    fn default() -> Self {
        Self {
            total_pushed: 0,
            total_popped: 0,
            total_dropped: 0,
            current_size: 0,
            peak_size: 0,
            capacity: 0,
        }
    }
}

/// Lock-free circular buffer for DataChunks
///
/// Uses crossbeam's ArrayQueue for lock-free multi-producer/multi-consumer
/// operations with configurable overflow handling.
pub struct CircularDataBuffer {
    buffer: Arc<ArrayQueue<DataChunk>>,
    capacity: usize,
    overflow_strategy: OverflowStrategy,

    // Atomic counters for lock-free metrics
    total_pushed: AtomicU64,
    total_popped: AtomicU64,
    total_dropped: AtomicU64,
    peak_size: AtomicUsize,
}

impl CircularDataBuffer {
    /// Create a new circular buffer with specified capacity and overflow strategy
    pub fn new(capacity: usize, strategy: OverflowStrategy) -> Self {
        Self {
            buffer: Arc::new(ArrayQueue::new(capacity)),
            capacity,
            overflow_strategy: strategy,
            total_pushed: AtomicU64::new(0),
            total_popped: AtomicU64::new(0),
            total_dropped: AtomicU64::new(0),
            peak_size: AtomicUsize::new(0),
        }
    }

    /// Push a chunk into the buffer
    ///
    /// Returns Ok(()) if successful, or Err(chunk) if overflow strategy prevents push
    pub fn push(&self, chunk: DataChunk) -> Result<(), DataChunk> {
        let result = match self.overflow_strategy {
            OverflowStrategy::DropOldest => {
                // If full, drop the oldest item
                if self.buffer.is_full() {
                    self.buffer.pop(); // Drop oldest
                    self.total_dropped.fetch_add(1, Ordering::Relaxed);
                }
                self.buffer.push(chunk).ok();
                Ok(())
            }
            OverflowStrategy::DropNewest => {
                // Try to push, drop newest if full
                self.buffer.push(chunk.clone()).map_err(|_| {
                    self.total_dropped.fetch_add(1, Ordering::Relaxed);
                    chunk
                })
            }
            OverflowStrategy::Block => {
                // For blocking, we'd need async support
                // For now, behave like DropNewest
                self.buffer.push(chunk.clone()).map_err(|_| chunk)
            }
        };

        if result.is_ok() {
            self.total_pushed.fetch_add(1, Ordering::Relaxed);

            // Update peak size
            let current_size = self.buffer.len();
            self.peak_size.fetch_max(current_size, Ordering::Relaxed);
        }

        result
    }

    /// Pop a chunk from the buffer
    pub fn pop(&self) -> Option<DataChunk> {
        self.buffer.pop().map(|chunk| {
            self.total_popped.fetch_add(1, Ordering::Relaxed);
            chunk
        })
    }

    /// Drain up to max_items from the buffer
    ///
    /// Returns a vector of chunks, ordered oldest to newest
    pub fn drain(&self, max_items: usize) -> Vec<DataChunk> {
        let mut items = Vec::with_capacity(max_items.min(self.buffer.len()));

        for _ in 0..max_items {
            if let Some(chunk) = self.pop() {
                items.push(chunk);
            } else {
                break;
            }
        }

        items
    }

    /// Get current number of items in buffer
    pub fn len(&self) -> usize {
        self.buffer.len()
    }

    /// Check if buffer is empty
    pub fn is_empty(&self) -> bool {
        self.buffer.is_empty()
    }

    /// Check if buffer is full
    pub fn is_full(&self) -> bool {
        self.buffer.is_full()
    }

    /// Get buffer capacity
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    /// Get current metrics
    pub fn get_metrics(&self) -> BufferMetrics {
        BufferMetrics {
            total_pushed: self.total_pushed.load(Ordering::Relaxed),
            total_popped: self.total_popped.load(Ordering::Relaxed),
            total_dropped: self.total_dropped.load(Ordering::Relaxed),
            current_size: self.buffer.len(),
            peak_size: self.peak_size.load(Ordering::Relaxed),
            capacity: self.capacity,
        }
    }

    /// Reset metrics (useful for testing or session restart)
    pub fn reset_metrics(&self) {
        self.total_pushed.store(0, Ordering::Relaxed);
        self.total_popped.store(0, Ordering::Relaxed);
        self.total_dropped.store(0, Ordering::Relaxed);
        self.peak_size.store(0, Ordering::Relaxed);
    }

    /// Clear all items from buffer
    pub fn clear(&self) {
        while self.buffer.pop().is_some() {}
    }
}

// Thread-safe clone
impl Clone for CircularDataBuffer {
    fn clone(&self) -> Self {
        Self {
            buffer: Arc::clone(&self.buffer),
            capacity: self.capacity,
            overflow_strategy: self.overflow_strategy,
            total_pushed: AtomicU64::new(self.total_pushed.load(Ordering::Relaxed)),
            total_popped: AtomicU64::new(self.total_popped.load(Ordering::Relaxed)),
            total_dropped: AtomicU64::new(self.total_dropped.load(Ordering::Relaxed)),
            peak_size: AtomicUsize::new(self.peak_size.load(Ordering::Relaxed)),
        }
    }
}

/// Generic circular buffer for any serializable type
///
/// Useful for buffering DDA results, annotations, or other data types
pub struct CircularBuffer<T: Clone> {
    buffer: Arc<ArrayQueue<T>>,
    capacity: usize,
    overflow_strategy: OverflowStrategy,
    total_pushed: AtomicU64,
    total_dropped: AtomicU64,
}

impl<T: Clone> CircularBuffer<T> {
    pub fn new(capacity: usize, strategy: OverflowStrategy) -> Self {
        Self {
            buffer: Arc::new(ArrayQueue::new(capacity)),
            capacity,
            overflow_strategy: strategy,
            total_pushed: AtomicU64::new(0),
            total_dropped: AtomicU64::new(0),
        }
    }

    pub fn push(&self, item: T) -> Result<(), T> {
        let result = match self.overflow_strategy {
            OverflowStrategy::DropOldest => {
                if self.buffer.is_full() {
                    self.buffer.pop();
                    self.total_dropped.fetch_add(1, Ordering::Relaxed);
                }
                self.buffer.push(item).ok();
                Ok(())
            }
            OverflowStrategy::DropNewest => self.buffer.push(item.clone()).map_err(|_| {
                self.total_dropped.fetch_add(1, Ordering::Relaxed);
                item
            }),
            OverflowStrategy::Block => self.buffer.push(item.clone()).map_err(|_| item),
        };

        if result.is_ok() {
            self.total_pushed.fetch_add(1, Ordering::Relaxed);
        }

        result
    }

    pub fn pop(&self) -> Option<T> {
        self.buffer.pop()
    }

    pub fn drain(&self, max_items: usize) -> Vec<T> {
        let mut items = Vec::with_capacity(max_items.min(self.buffer.len()));
        for _ in 0..max_items {
            if let Some(item) = self.pop() {
                items.push(item);
            } else {
                break;
            }
        }
        items
    }

    pub fn len(&self) -> usize {
        self.buffer.len()
    }

    pub fn is_empty(&self) -> bool {
        self.buffer.is_empty()
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }

    pub fn clear(&self) {
        while self.buffer.pop().is_some() {}
    }
}

impl<T: Clone> Clone for CircularBuffer<T> {
    fn clone(&self) -> Self {
        Self {
            buffer: Arc::clone(&self.buffer),
            capacity: self.capacity,
            overflow_strategy: self.overflow_strategy,
            total_pushed: AtomicU64::new(self.total_pushed.load(Ordering::Relaxed)),
            total_dropped: AtomicU64::new(self.total_dropped.load(Ordering::Relaxed)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_chunk(seq: u64) -> DataChunk {
        DataChunk {
            samples: vec![vec![1.0, 2.0, 3.0]],
            timestamp: seq as f64,
            sample_rate: 250.0,
            channel_names: vec!["Test".to_string()],
            sequence: Some(seq),
        }
    }

    #[test]
    fn test_push_pop() {
        let buffer = CircularDataBuffer::new(10, OverflowStrategy::DropNewest);

        let chunk = create_test_chunk(1);
        assert!(buffer.push(chunk).is_ok());
        assert_eq!(buffer.len(), 1);

        let popped = buffer.pop();
        assert!(popped.is_some());
        assert_eq!(popped.unwrap().sequence, Some(1));
        assert_eq!(buffer.len(), 0);
    }

    #[test]
    fn test_drop_oldest() {
        let buffer = CircularDataBuffer::new(3, OverflowStrategy::DropOldest);

        // Fill buffer
        buffer.push(create_test_chunk(1)).ok();
        buffer.push(create_test_chunk(2)).ok();
        buffer.push(create_test_chunk(3)).ok();
        assert_eq!(buffer.len(), 3);

        // Push one more - should drop oldest (1)
        buffer.push(create_test_chunk(4)).ok();
        assert_eq!(buffer.len(), 3);

        // Drain should give us 2, 3, 4
        let chunks = buffer.drain(10);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].sequence, Some(2));
        assert_eq!(chunks[1].sequence, Some(3));
        assert_eq!(chunks[2].sequence, Some(4));
    }

    #[test]
    fn test_metrics() {
        let buffer = CircularDataBuffer::new(5, OverflowStrategy::DropOldest);

        buffer.push(create_test_chunk(1)).ok();
        buffer.push(create_test_chunk(2)).ok();

        let metrics = buffer.get_metrics();
        assert_eq!(metrics.total_pushed, 2);
        assert_eq!(metrics.current_size, 2);
        assert_eq!(metrics.peak_size, 2);

        buffer.pop();
        let metrics = buffer.get_metrics();
        assert_eq!(metrics.total_popped, 1);
        assert_eq!(metrics.current_size, 1);
    }
}
