/**
 * BIDS Cache Service
 * Centralized caching for BIDS dataset structures with LRU eviction policy.
 * Replaces the global window.__bids_cache pattern.
 */

import type { BIDSSubject, BIDSSession } from "@/services/bids/reader";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  accessCount: number;
}

interface BIDSCacheConfig {
  maxEntries: number;
  ttlMs: number;
}

const DEFAULT_CONFIG: BIDSCacheConfig = {
  maxEntries: 50,
  ttlMs: 30 * 60 * 1000, // 30 minutes
};

class BIDSCacheService {
  private subjectCache: Map<string, CacheEntry<BIDSSubject[]>> = new Map();
  private sessionCache: Map<string, CacheEntry<BIDSSession[]>> = new Map();
  private config: BIDSCacheConfig;

  constructor(config: Partial<BIDSCacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get cached subjects for a BIDS dataset path
   */
  getSubjects(bidsPath: string): BIDSSubject[] | null {
    const entry = this.subjectCache.get(bidsPath);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.timestamp > this.config.ttlMs) {
      this.subjectCache.delete(bidsPath);
      return null;
    }

    // Update access count for LRU
    entry.accessCount++;
    return entry.data;
  }

  /**
   * Cache subjects for a BIDS dataset path
   */
  setSubjects(bidsPath: string, subjects: BIDSSubject[]): void {
    this.evictIfNeeded(this.subjectCache);
    this.subjectCache.set(bidsPath, {
      data: subjects,
      timestamp: Date.now(),
      accessCount: 1,
    });
  }

  /**
   * Get cached sessions for a subject path
   */
  getSessions(subjectPath: string): BIDSSession[] | null {
    const entry = this.sessionCache.get(subjectPath);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.timestamp > this.config.ttlMs) {
      this.sessionCache.delete(subjectPath);
      return null;
    }

    // Update access count for LRU
    entry.accessCount++;
    return entry.data;
  }

  /**
   * Cache sessions for a subject path
   */
  setSessions(subjectPath: string, sessions: BIDSSession[]): void {
    this.evictIfNeeded(this.sessionCache);
    this.sessionCache.set(subjectPath, {
      data: sessions,
      timestamp: Date.now(),
      accessCount: 1,
    });
  }

  /**
   * Check if a path is inside a known BIDS root
   */
  findBIDSRoot(absolutePath: string): string | null {
    for (const bidsRoot of this.subjectCache.keys()) {
      if (absolutePath.startsWith(bidsRoot + "/")) {
        return bidsRoot;
      }
    }
    return null;
  }

  /**
   * Get BIDS context for a path (root, depth, relative path)
   */
  getBIDSContext(absolutePath: string): {
    isInsideBIDS: boolean;
    bidsRoot: string | null;
    relativePath: string | null;
    depth: number;
    currentSegment: string | null;
  } {
    const bidsRoot = this.findBIDSRoot(absolutePath);

    if (!bidsRoot) {
      return {
        isInsideBIDS: false,
        bidsRoot: null,
        relativePath: null,
        depth: 0,
        currentSegment: null,
      };
    }

    const relativePath = absolutePath.substring(bidsRoot.length + 1);
    const segments = relativePath.split("/").filter(Boolean);

    return {
      isInsideBIDS: true,
      bidsRoot,
      relativePath,
      depth: segments.length,
      currentSegment: segments[segments.length - 1] || null,
    };
  }

  /**
   * Find subject data by ID within a BIDS root
   */
  findSubject(bidsRoot: string, subjectId: string): BIDSSubject | null {
    const subjects = this.getSubjects(bidsRoot);
    if (!subjects) return null;
    return subjects.find((s) => s.id === subjectId) || null;
  }

  /**
   * Invalidate cache for a specific BIDS path
   */
  invalidate(bidsPath: string): void {
    this.subjectCache.delete(bidsPath);
    // Also invalidate any session caches under this path
    for (const key of this.sessionCache.keys()) {
      if (key.startsWith(bidsPath)) {
        this.sessionCache.delete(key);
      }
    }
  }

  /**
   * Clear all cached data
   */
  clear(): void {
    this.subjectCache.clear();
    this.sessionCache.clear();
  }

  /**
   * Get cache statistics for debugging
   */
  getStats(): {
    subjectCacheSize: number;
    sessionCacheSize: number;
    bidsRoots: string[];
  } {
    return {
      subjectCacheSize: this.subjectCache.size,
      sessionCacheSize: this.sessionCache.size,
      bidsRoots: Array.from(this.subjectCache.keys()),
    };
  }

  /**
   * LRU eviction when cache is full
   */
  private evictIfNeeded<T>(cache: Map<string, CacheEntry<T>>): void {
    if (cache.size < this.config.maxEntries) return;

    // Find least recently used entry (lowest access count + oldest)
    let lruKey: string | null = null;
    let lruScore = Infinity;

    for (const [key, entry] of cache.entries()) {
      // Score = accessCount * recency (lower is more evictable)
      const recency = Date.now() - entry.timestamp;
      const score = entry.accessCount / (recency / 1000 + 1);
      if (score < lruScore) {
        lruScore = score;
        lruKey = key;
      }
    }

    if (lruKey) {
      cache.delete(lruKey);
    }
  }
}

// Singleton instance
export const bidsCache = new BIDSCacheService();

// Export class for testing
export { BIDSCacheService };
export type { BIDSCacheConfig };
