/**
 * Performance Profiling Utilities for DDALAB
 *
 * Provides comprehensive performance monitoring and profiling capabilities:
 * - Component render time tracking
 * - Function execution profiling
 * - Memory usage monitoring
 * - Performance marks and measures
 * - Bottleneck detection
 */

export interface PerformanceMetric {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata?: Record<string, any>;
}

export interface PerformanceReport {
  totalDuration: number;
  metrics: PerformanceMetric[];
  bottlenecks: PerformanceMetric[];
  averages: Record<string, number>;
  recommendations: string[];
}

class PerformanceProfiler {
  private metrics: Map<string, PerformanceMetric> = new Map();
  private completedMetrics: PerformanceMetric[] = [];
  private enabled: boolean = process.env.NODE_ENV === "development";

  /**
   * Enable or disable profiling
   */
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  /**
   * Start timing a named operation
   */
  start(name: string, metadata?: Record<string, any>): void {
    if (!this.enabled) return;

    const metric: PerformanceMetric = {
      name,
      startTime: performance.now(),
      metadata,
    };

    this.metrics.set(name, metric);

    // Use Performance API marks
    if ("mark" in performance) {
      performance.mark(`${name}-start`);
    }
  }

  /**
   * End timing a named operation
   */
  end(name: string): number | undefined {
    if (!this.enabled) return undefined;

    const metric = this.metrics.get(name);
    if (!metric) {
      console.warn(`[Profiler] No start mark found for: ${name}`);
      return undefined;
    }

    const endTime = performance.now();
    const duration = endTime - metric.startTime;

    metric.endTime = endTime;
    metric.duration = duration;

    this.completedMetrics.push(metric);
    this.metrics.delete(name);

    // Use Performance API measures
    if ("mark" in performance && "measure" in performance) {
      try {
        performance.mark(`${name}-end`);
        performance.measure(name, `${name}-start`, `${name}-end`);
      } catch (e) {
        // Ignore errors from missing marks
      }
    }

    // Log slow operations (>100ms)
    if (duration > 100) {
      console.warn(
        `[Profiler] Slow operation detected: ${name} took ${duration.toFixed(2)}ms`,
        metric.metadata,
      );
    }

    return duration;
  }

  /**
   * Measure a function execution
   */
  async measure<T>(
    name: string,
    fn: () => T | Promise<T>,
    metadata?: Record<string, any>,
  ): Promise<T> {
    this.start(name, metadata);
    try {
      const result = await fn();
      this.end(name);
      return result;
    } catch (error) {
      this.end(name);
      throw error;
    }
  }

  /**
   * Measure a synchronous function
   */
  measureSync<T>(name: string, fn: () => T, metadata?: Record<string, any>): T {
    this.start(name, metadata);
    try {
      const result = fn();
      this.end(name);
      return result;
    } catch (error) {
      this.end(name);
      throw error;
    }
  }

  /**
   * Get all completed metrics
   */
  getMetrics(): PerformanceMetric[] {
    return [...this.completedMetrics];
  }

  /**
   * Get metrics filtered by name pattern
   */
  getMetricsByPattern(pattern: RegExp): PerformanceMetric[] {
    return this.completedMetrics.filter((m) => pattern.test(m.name));
  }

  /**
   * Get average duration for operations matching a pattern
   */
  getAverage(pattern: RegExp): number {
    const matching = this.getMetricsByPattern(pattern);
    if (matching.length === 0) return 0;

    const total = matching.reduce((sum, m) => sum + (m.duration || 0), 0);
    return total / matching.length;
  }

  /**
   * Generate a performance report
   */
  generateReport(threshold: number = 50): PerformanceReport {
    const metrics = this.getMetrics();

    // Find bottlenecks (operations taking longer than threshold)
    const bottlenecks = metrics.filter((m) => (m.duration || 0) > threshold);
    bottlenecks.sort((a, b) => (b.duration || 0) - (a.duration || 0));

    // Calculate averages for different operation types
    const averages: Record<string, number> = {
      render: this.getAverage(/render/i),
      data_processing: this.getAverage(/process|transform|compute/i),
      api_call: this.getAverage(/api|fetch|load/i),
      user_interaction: this.getAverage(/click|scroll|input/i),
    };

    // Generate recommendations
    const recommendations: string[] = [];

    if (averages.render > 100) {
      recommendations.push(
        "Render times are high (>100ms). Consider: virtualizing long lists, memoizing expensive computations, or splitting into smaller components.",
      );
    }

    if (averages.data_processing > 200) {
      recommendations.push(
        "Data processing is slow (>200ms). Consider: using Web Workers for heavy computations, implementing incremental processing, or optimizing algorithms.",
      );
    }

    if (bottlenecks.length > 5) {
      recommendations.push(
        `${bottlenecks.length} bottlenecks detected. Focus on optimizing: ${bottlenecks
          .slice(0, 3)
          .map((b) => b.name)
          .join(", ")}`,
      );
    }

    const totalDuration = metrics.reduce(
      (sum, m) => sum + (m.duration || 0),
      0,
    );

    return {
      totalDuration,
      metrics,
      bottlenecks,
      averages,
      recommendations,
    };
  }

  /**
   * Print a formatted performance report to console
   */
  printReport(threshold: number = 50): void {
    const report = this.generateReport(threshold);

    console.group("📊 Performance Report");

    console.log(`Total measured time: ${report.totalDuration.toFixed(2)}ms`);
    console.log(`Total operations: ${report.metrics.length}`);

    if (report.bottlenecks.length > 0) {
      console.group(
        `⚠️ Bottlenecks (${report.bottlenecks.length} operations > ${threshold}ms)`,
      );
      report.bottlenecks.forEach((b, i) => {
        console.log(
          `${i + 1}. ${b.name}: ${b.duration?.toFixed(2)}ms`,
          b.metadata || "",
        );
      });
      console.groupEnd();
    }

    console.group("📈 Average Times by Category");
    Object.entries(report.averages).forEach(([category, avg]) => {
      if (avg > 0) {
        console.log(`${category}: ${avg.toFixed(2)}ms`);
      }
    });
    console.groupEnd();

    if (report.recommendations.length > 0) {
      console.group("💡 Recommendations");
      report.recommendations.forEach((rec, i) => {
        console.log(`${i + 1}. ${rec}`);
      });
      console.groupEnd();
    }

    console.groupEnd();
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics.clear();
    this.completedMetrics = [];

    // Clear Performance API marks/measures
    if ("clearMarks" in performance) {
      performance.clearMarks();
    }
    if ("clearMeasures" in performance) {
      performance.clearMeasures();
    }
  }

  /**
   * Get browser performance entries
   */
  getBrowserMetrics(): PerformanceEntry[] {
    if ("getEntriesByType" in performance) {
      return [
        ...performance.getEntriesByType("navigation"),
        ...performance.getEntriesByType("resource"),
        ...performance.getEntriesByType("measure"),
        ...performance.getEntriesByType("paint"),
      ];
    }
    return [];
  }

  /**
   * Monitor memory usage (Chrome only)
   */
  getMemoryUsage(): {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    limit: number;
  } | null {
    // @ts-ignore - Chrome-specific API
    if (performance.memory) {
      // @ts-ignore
      return {
        // @ts-ignore
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        // @ts-ignore
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        // @ts-ignore
        limit: performance.memory.jsHeapSizeLimit,
      };
    }
    return null;
  }

  /**
   * Log memory usage if available
   */
  logMemoryUsage(): void {
    const memory = this.getMemoryUsage();
    if (memory) {
      const usedMB = (memory.usedJSHeapSize / 1024 / 1024).toFixed(2);
      const totalMB = (memory.totalJSHeapSize / 1024 / 1024).toFixed(2);
      const limitMB = (memory.limit / 1024 / 1024).toFixed(2);
      console.log(
        `💾 Memory: ${usedMB}MB / ${totalMB}MB (limit: ${limitMB}MB)`,
      );
    }
  }
}

// Export singleton instance
export const profiler = new PerformanceProfiler();

/**
 * React hook for profiling component renders
 */
export function useRenderProfiler(componentName: string) {
  const renderCount = useRef(0);
  const renderStartTime = useRef(0);

  // Increment render count and start timing at the BEGINNING of render (synchronous)
  renderCount.current++;
  const currentRenderCount = renderCount.current;

  // Start timing at the beginning of this render
  if (renderStartTime.current === 0) {
    renderStartTime.current = performance.now();
  }

  // Log excessive re-renders (synchronously during render)
  if (renderCount.current > 10 && renderCount.current % 10 === 0) {
    console.warn(
      `[Profiler] ${componentName} has rendered ${renderCount.current} times. Consider memoization.`,
    );
  }

  useEffect(() => {
    // Measure time from render start to effect execution
    const renderEndTime = performance.now();
    const renderDuration = renderEndTime - renderStartTime.current;

    if (renderDuration > 0) {
      // Create a completed metric directly
      const metric: PerformanceMetric = {
        name: `${componentName}-render`,
        startTime: renderStartTime.current,
        endTime: renderEndTime,
        duration: renderDuration,
        metadata: {
          renderCount: currentRenderCount,
          category: "render",
        },
      };

      // Add to profiler manually
      (profiler as any).completedMetrics.push(metric);

      // Log slow renders
      if (renderDuration > 100) {
        console.warn(
          `[Profiler] Slow render detected: ${componentName} (render #${currentRenderCount}) took ${renderDuration.toFixed(2)}ms`,
        );
      }
    }

    // Reset start time for next render
    renderStartTime.current = performance.now();
  });
}

/**
 * Higher-order function to profile async functions
 */
export function profileAsync<T extends (...args: any[]) => Promise<any>>(
  name: string,
  fn: T,
): T {
  return (async (...args: Parameters<T>) => {
    return await profiler.measure(name, () => fn(...args), {
      args: args.length,
    });
  }) as T;
}

/**
 * Higher-order function to profile sync functions
 */
export function profileSync<T extends (...args: any[]) => any>(
  name: string,
  fn: T,
): T {
  return ((...args: Parameters<T>) => {
    return profiler.measureSync(name, () => fn(...args), {
      args: args.length,
    });
  }) as T;
}

// Import useRef and useEffect for the hook
import { useRef, useEffect } from "react";

// Enable profiler in development
if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  // Make profiler available globally for debugging
  (window as any).profiler = profiler;

  console.log(
    "%c[Profiler] Performance profiling enabled. Use window.profiler.printReport() to see results.",
    "color: #00B0F0; font-weight: bold;",
  );
}

export default profiler;
