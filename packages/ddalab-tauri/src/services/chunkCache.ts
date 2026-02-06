/**
 * Client-side LRU cache for EDF/signal data chunks
 *
 * Reduces redundant API calls when:
 * - Toggling channel visibility
 * - Changing preprocessing filters
 * - Navigating back to previously viewed time ranges
 *
 * Uses a doubly-linked list with Map for O(1) LRU operations.
 */

import { ChunkData } from "@/types/api";

interface LRUNode {
  key: string;
  prev: LRUNode | null;
  next: LRUNode | null;
}

interface CacheEntry {
  data: ChunkData;
  timestamp: number;
  size: number; // Estimated memory size in bytes
  node: LRUNode; // Reference to LRU list node for O(1) removal
}

interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  totalSize: number;
  entryCount: number;
}

export class ChunkCache {
  private cache: Map<string, CacheEntry>;
  private head: LRUNode | null; // Least recently used (front)
  private tail: LRUNode | null; // Most recently used (back)
  private maxSize: number; // Max cache size in bytes
  private currentSize: number;
  private stats: CacheStats;

  constructor(maxSizeMB: number = 100) {
    this.cache = new Map();
    this.head = null;
    this.tail = null;
    this.maxSize = maxSizeMB * 1024 * 1024; // Convert to bytes
    this.currentSize = 0;
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      totalSize: 0,
      entryCount: 0,
    };
  }

  /**
   * Generate cache key from chunk parameters
   * Includes channel list to cache different channel selections separately
   */
  private generateKey(
    filePath: string,
    chunkStart: number,
    chunkSize: number,
    channels?: string[],
  ): string {
    const channelKey =
      channels && channels.length > 0
        ? channels.sort().join(",") // Sort for consistent cache keys
        : "all";
    return `${filePath}:${chunkStart}:${chunkSize}:${channelKey}`;
  }

  /**
   * Estimate memory size of chunk data in bytes
   */
  private estimateSize(chunk: ChunkData): number {
    // Each float64 is 8 bytes
    // data is array of arrays: channels × samples
    const dataSize = chunk.data.reduce(
      (sum, channel) => sum + channel.length * 8,
      0,
    );

    // Timestamps array
    const timestampSize = (chunk.timestamps?.length || 0) * 8;

    // Channel labels (rough estimate: 20 bytes per label)
    const labelsSize = chunk.channels.length * 20;

    // Metadata overhead
    const overhead = 200;

    return dataSize + timestampSize + labelsSize + overhead;
  }

  /**
   * Remove a node from the doubly-linked list - O(1)
   */
  private removeNode(node: LRUNode): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }

    node.prev = null;
    node.next = null;
  }

  /**
   * Add a node to the tail (most recently used) - O(1)
   */
  private addToTail(node: LRUNode): void {
    node.prev = this.tail;
    node.next = null;

    if (this.tail) {
      this.tail.next = node;
    } else {
      this.head = node;
    }

    this.tail = node;
  }

  /**
   * Move existing node to tail (most recently used) - O(1)
   */
  private moveToTail(node: LRUNode): void {
    if (node === this.tail) {
      return; // Already at tail
    }
    this.removeNode(node);
    this.addToTail(node);
  }

  /**
   * Evict least recently used entries until size is under limit - O(1) per eviction
   */
  private evictIfNeeded(): void {
    while (this.currentSize > this.maxSize && this.head) {
      const lruNode = this.head;
      const entry = this.cache.get(lruNode.key);

      if (entry) {
        this.removeNode(lruNode);
        this.cache.delete(lruNode.key);
        this.currentSize -= entry.size;
        this.stats.evictions++;
      }
    }
  }

  /**
   * Get chunk from cache - O(1)
   */
  get(
    filePath: string,
    chunkStart: number,
    chunkSize: number,
    channels?: string[],
  ): ChunkData | null {
    const key = this.generateKey(filePath, chunkStart, chunkSize, channels);
    const entry = this.cache.get(key);

    if (entry) {
      this.stats.hits++;
      this.moveToTail(entry.node);
      return entry.data;
    }

    this.stats.misses++;
    return null;
  }

  /**
   * Store chunk in cache - O(1)
   */
  set(
    filePath: string,
    chunkStart: number,
    chunkSize: number,
    data: ChunkData,
    channels?: string[],
  ): void {
    const key = this.generateKey(filePath, chunkStart, chunkSize, channels);
    const size = this.estimateSize(data);

    // Don't cache chunks larger than max size
    if (size > this.maxSize) {
      return;
    }

    // Remove existing entry if present
    const existing = this.cache.get(key);
    if (existing) {
      this.currentSize -= existing.size;
      this.removeNode(existing.node);
    }

    // Create new LRU node
    const node: LRUNode = { key, prev: null, next: null };

    // Add new entry
    const entry: CacheEntry = {
      data,
      timestamp: Date.now(),
      size,
      node,
    };

    this.cache.set(key, entry);
    this.currentSize += size;
    this.addToTail(node);

    // Evict old entries if over limit
    this.evictIfNeeded();

    // Update stats
    this.stats.totalSize = this.currentSize;
    this.stats.entryCount = this.cache.size;
  }

  /**
   * Clear all entries for a specific file - O(n) where n is entries for that file
   */
  clearFile(filePath: string): void {
    const prefix = `${filePath}:`;
    for (const [key, entry] of this.cache.entries()) {
      if (key.startsWith(prefix)) {
        this.removeNode(entry.node);
        this.cache.delete(key);
        this.currentSize -= entry.size;
      }
    }

    this.stats.totalSize = this.currentSize;
    this.stats.entryCount = this.cache.size;
  }

  /**
   * Clear entire cache - O(1)
   */
  clear(): void {
    this.cache.clear();
    this.head = null;
    this.tail = null;
    this.currentSize = 0;
    this.stats.totalSize = 0;
    this.stats.entryCount = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Get cache hit rate as percentage
   */
  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses;
    return total === 0 ? 0 : (this.stats.hits / total) * 100;
  }

  /**
   * Get human-readable cache info
   */
  getInfo(): string {
    const hitRate = this.getHitRate();
    const sizeMB = this.currentSize / 1024 / 1024;
    const maxMB = this.maxSize / 1024 / 1024;

    return `Cache: ${this.cache.size} entries, ${sizeMB.toFixed(1)}/${maxMB.toFixed(0)}MB, ${hitRate.toFixed(1)}% hit rate`;
  }
}

// Singleton instance
let cacheInstance: ChunkCache | null = null;

/**
 * Get the global chunk cache instance
 */
export function getChunkCache(): ChunkCache {
  if (!cacheInstance) {
    cacheInstance = new ChunkCache(100); // 100MB default
  }
  return cacheInstance;
}

/**
 * Reset the global chunk cache (useful for testing)
 */
export function resetChunkCache(): void {
  if (cacheInstance) {
    cacheInstance.clear();
  }
  cacheInstance = null;
}
