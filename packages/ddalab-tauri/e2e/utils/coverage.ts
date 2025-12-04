import * as fs from "fs";
import * as path from "path";
import { Page } from "@playwright/test";

const COVERAGE_DIR = path.join(process.cwd(), "coverage-e2e");
const V8_DIR = path.join(COVERAGE_DIR, "v8");

let testCounter = 0;

export function initCoverageDir(): void {
  // Create directories
  if (!fs.existsSync(COVERAGE_DIR)) {
    fs.mkdirSync(COVERAGE_DIR, { recursive: true });
  }
  if (!fs.existsSync(V8_DIR)) {
    fs.mkdirSync(V8_DIR, { recursive: true });
  }

  // Clean up old V8 coverage files
  const files = fs.readdirSync(V8_DIR);
  for (const file of files) {
    if (file.endsWith(".json")) {
      fs.unlinkSync(path.join(V8_DIR, file));
    }
  }
}

export async function startCoverage(page: Page): Promise<void> {
  await page.coverage.startJSCoverage({
    resetOnNavigation: false,
  });
}

export async function stopCoverage(page: Page): Promise<void> {
  const coverage = await page.coverage.stopJSCoverage();

  if (coverage.length === 0) {
    return;
  }

  // Filter coverage to only include app code
  const filteredCoverage = coverage.filter((entry) => {
    if (!entry.url) return false;
    if (entry.url.startsWith("chrome-extension://")) return false;
    if (!entry.url.includes("localhost:3003")) return false;
    if (entry.url.includes("node_modules")) return false;
    if (entry.url.includes("_next/static/chunks/webpack")) return false;
    return true;
  });

  if (filteredCoverage.length === 0) {
    return;
  }

  // Create directories if needed
  if (!fs.existsSync(V8_DIR)) {
    fs.mkdirSync(V8_DIR, { recursive: true });
  }

  // Save V8 coverage to a unique file
  const filename = `v8-${process.pid}-${testCounter++}-${Date.now()}.json`;
  const filepath = path.join(V8_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(filteredCoverage, null, 2));
}

export async function generateReport(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const CoverageReport = require("monocart-coverage-reports");

  const mcr = new CoverageReport({
    name: "DDALAB E2E Coverage Report",
    outputDir: COVERAGE_DIR,
    reports: ["v8", "console-summary"],
    entryFilter: (entry: { url?: string }) => {
      if (!entry.url) return false;
      // Only include app code
      if (entry.url.includes("node_modules")) return false;
      if (entry.url.includes("_next/static/chunks/webpack")) return false;
      return entry.url.includes("localhost:3003");
    },
    sourceFilter: (sourcePath: string) => {
      // Filter out non-source files
      if (sourcePath.includes("node_modules")) return false;
      return true;
    },
  });

  // Load all V8 coverage files
  if (fs.existsSync(V8_DIR)) {
    const files = fs.readdirSync(V8_DIR);
    for (const file of files) {
      if (file.endsWith(".json")) {
        const filepath = path.join(V8_DIR, file);
        const data = JSON.parse(fs.readFileSync(filepath, "utf-8"));
        await mcr.add(data);
      }
    }
  }

  // Generate the report
  await mcr.generate();
}
