/**
 * Client-side LRU cache for EDF/signal data chunks
 *
 * Reduces redundant API calls when:
 * - Toggling channel visibility
 * - Changing preprocessing filters
 * - Navigating back to previously viewed time ranges
 */

import { ChunkData } from '@/types/api'

interface CacheEntry {
  data: ChunkData
  timestamp: number
  size: number // Estimated memory size in bytes
}

interface CacheStats {
  hits: number
  misses: number
  evictions: number
  totalSize: number
  entryCount: number
}

export class ChunkCache {
  private cache: Map<string, CacheEntry>
  private accessOrder: string[] // LRU tracking
  private maxSize: number // Max cache size in bytes
  private currentSize: number
  private stats: CacheStats

  constructor(maxSizeMB: number = 100) {
    this.cache = new Map()
    this.accessOrder = []
    this.maxSize = maxSizeMB * 1024 * 1024 // Convert to bytes
    this.currentSize = 0
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      totalSize: 0,
      entryCount: 0
    }
  }

  /**
   * Generate cache key from chunk parameters
   * Note: Excludes channel list to enable cache hits when toggling visibility
   */
  private generateKey(
    filePath: string,
    chunkStart: number,
    chunkSize: number
  ): string {
    return `${filePath}:${chunkStart}:${chunkSize}`
  }

  /**
   * Estimate memory size of chunk data in bytes
   */
  private estimateSize(chunk: ChunkData): number {
    // Each float64 is 8 bytes
    // data is array of arrays: channels × samples
    const dataSize = chunk.data.reduce((sum, channel) => sum + channel.length * 8, 0)

    // Timestamps array
    const timestampSize = (chunk.timestamps?.length || 0) * 8

    // Channel labels (rough estimate: 20 bytes per label)
    const labelsSize = chunk.channels.length * 20

    // Metadata overhead
    const overhead = 200

    return dataSize + timestampSize + labelsSize + overhead
  }

  /**
   * Update LRU order when key is accessed
   */
  private touch(key: string): void {
    // Remove from current position
    const index = this.accessOrder.indexOf(key)
    if (index > -1) {
      this.accessOrder.splice(index, 1)
    }
    // Add to end (most recently used)
    this.accessOrder.push(key)
  }

  /**
   * Evict least recently used entries until size is under limit
   */
  private evictIfNeeded(): void {
    while (this.currentSize > this.maxSize && this.accessOrder.length > 0) {
      const lruKey = this.accessOrder.shift()! // Remove least recently used
      const entry = this.cache.get(lruKey)

      if (entry) {
        this.cache.delete(lruKey)
        this.currentSize -= entry.size
        this.stats.evictions++

        console.log(`[ChunkCache] Evicted LRU entry: ${lruKey}, freed ${(entry.size / 1024).toFixed(1)}KB`)
      }
    }
  }

  /**
   * Get chunk from cache
   */
  get(
    filePath: string,
    chunkStart: number,
    chunkSize: number
  ): ChunkData | null {
    const key = this.generateKey(filePath, chunkStart, chunkSize)
    const entry = this.cache.get(key)

    if (entry) {
      this.stats.hits++
      this.touch(key)
      console.log(`[ChunkCache] HIT: ${key} (hit rate: ${this.getHitRate().toFixed(1)}%)`)
      return entry.data
    }

    this.stats.misses++
    console.log(`[ChunkCache] MISS: ${key} (hit rate: ${this.getHitRate().toFixed(1)}%)`)
    return null
  }

  /**
   * Store chunk in cache
   */
  set(
    filePath: string,
    chunkStart: number,
    chunkSize: number,
    data: ChunkData
  ): void {
    const key = this.generateKey(filePath, chunkStart, chunkSize)
    const size = this.estimateSize(data)

    // Don't cache chunks larger than max size
    if (size > this.maxSize) {
      console.warn(`[ChunkCache] Chunk ${key} too large to cache: ${(size / 1024 / 1024).toFixed(1)}MB`)
      return
    }

    // Remove existing entry if present
    const existing = this.cache.get(key)
    if (existing) {
      this.currentSize -= existing.size
    }

    // Add new entry
    const entry: CacheEntry = {
      data,
      timestamp: Date.now(),
      size
    }

    this.cache.set(key, entry)
    this.currentSize += size
    this.touch(key)

    console.log(`[ChunkCache] SET: ${key}, size: ${(size / 1024).toFixed(1)}KB, total: ${(this.currentSize / 1024 / 1024).toFixed(1)}MB/${(this.maxSize / 1024 / 1024).toFixed(0)}MB`)

    // Evict old entries if over limit
    this.evictIfNeeded()

    // Update stats
    this.stats.totalSize = this.currentSize
    this.stats.entryCount = this.cache.size
  }

  /**
   * Clear all entries for a specific file
   */
  clearFile(filePath: string): void {
    let cleared = 0
    let freedSize = 0

    for (const [key, entry] of this.cache.entries()) {
      if (key.startsWith(`${filePath}:`)) {
        this.cache.delete(key)
        this.currentSize -= entry.size
        freedSize += entry.size
        cleared++

        // Remove from LRU order
        const index = this.accessOrder.indexOf(key)
        if (index > -1) {
          this.accessOrder.splice(index, 1)
        }
      }
    }

    console.log(`[ChunkCache] Cleared ${cleared} entries for ${filePath}, freed ${(freedSize / 1024 / 1024).toFixed(1)}MB`)

    this.stats.totalSize = this.currentSize
    this.stats.entryCount = this.cache.size
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    const entries = this.cache.size
    const size = this.currentSize

    this.cache.clear()
    this.accessOrder = []
    this.currentSize = 0

    console.log(`[ChunkCache] Cleared all ${entries} entries, freed ${(size / 1024 / 1024).toFixed(1)}MB`)

    this.stats.totalSize = 0
    this.stats.entryCount = 0
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats }
  }

  /**
   * Get cache hit rate as percentage
   */
  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses
    return total === 0 ? 0 : (this.stats.hits / total) * 100
  }

  /**
   * Get human-readable cache info
   */
  getInfo(): string {
    const hitRate = this.getHitRate()
    const sizeMB = this.currentSize / 1024 / 1024
    const maxMB = this.maxSize / 1024 / 1024

    return `Cache: ${this.cache.size} entries, ${sizeMB.toFixed(1)}/${maxMB.toFixed(0)}MB, ${hitRate.toFixed(1)}% hit rate`
  }

  /**
   * Filter cached chunk data to only include specific channels
   * This allows cache hits even when different channels are selected
   */
  filterChannels(chunk: ChunkData, requestedChannels: string[]): ChunkData {
    if (!requestedChannels || requestedChannels.length === 0) {
      return chunk
    }

    // Find indices of requested channels
    const indices: number[] = []
    const filteredChannels: string[] = []

    for (const reqChannel of requestedChannels) {
      const index = chunk.channels.indexOf(reqChannel)
      if (index !== -1) {
        indices.push(index)
        filteredChannels.push(reqChannel)
      }
    }

    // Extract only the requested channel data
    const filteredData = indices.map(i => chunk.data[i])

    return {
      ...chunk,
      data: filteredData,
      channels: filteredChannels
    }
  }
}

// Singleton instance
let cacheInstance: ChunkCache | null = null

/**
 * Get the global chunk cache instance
 */
export function getChunkCache(): ChunkCache {
  if (!cacheInstance) {
    cacheInstance = new ChunkCache(100) // 100MB default
  }
  return cacheInstance
}

/**
 * Reset the global chunk cache (useful for testing)
 */
export function resetChunkCache(): void {
  if (cacheInstance) {
    cacheInstance.clear()
  }
  cacheInstance = null
}
