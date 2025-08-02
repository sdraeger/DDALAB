#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

// Test the docker-compose.yml parsing logic
function testDockerComposeParsing() {
  console.log("Testing docker-compose.yml parsing...");

  // Read the original docker-compose.yml
  const composePath = path.join(__dirname, "..", "..", "docker-compose.yml");
  let composeContent = fs.readFileSync(composePath, "utf-8");

  console.log("Original file length:", composeContent.length);

  // Apply the same logic as in setup-service.ts
  const lines = composeContent.split("\n");
  const cleanedLines = [];
  let skipNextLines = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip lines if we're in a build section
    if (skipNextLines > 0) {
      skipNextLines--;
      continue;
    }

    // Check if this line starts a build section
    if (trimmed === "build:") {
      // Look ahead to see if this is a build section we want to remove
      let nextLine = "";
      let nextNextLine = "";
      if (i + 1 < lines.length) nextLine = lines[i + 1].trim();
      if (i + 2 < lines.length) nextNextLine = lines[i + 2].trim();

      if (
        nextLine === "context: ." &&
        (nextNextLine === "dockerfile: ./packages/web/Dockerfile" ||
          nextNextLine === "dockerfile: ./packages/api/Dockerfile")
      ) {
        console.log(`Found build section at line ${i + 1}: ${trimmed}`);
        console.log(`  Next line: ${nextLine}`);
        console.log(`  Next next line: ${nextNextLine}`);
        // Skip this build section (3 lines: build:, context: ., dockerfile: ...)
        skipNextLines = 2;
        continue;
      }
    }

    // Skip platform lines
    if (trimmed === "platform: linux/amd64") {
      console.log(`Skipping platform line at line ${i + 1}: ${trimmed}`);
      continue;
    }

    cleanedLines.push(line);
  }

  const cleanedContent = cleanedLines.join("\n");
  console.log("Cleaned file length:", cleanedContent.length);
  console.log(
    "Removed lines:",
    composeContent.split("\n").length - cleanedLines.length
  );

  // Write the cleaned content to a test file
  const testPath = path.join(__dirname, "test-docker-compose.yml");
  fs.writeFileSync(testPath, cleanedContent, "utf-8");
  console.log("Test file written to:", testPath);

  // Validate YAML syntax
  try {
    const yaml = require("js-yaml");
    yaml.load(cleanedContent);
    console.log("✅ YAML syntax is valid");
  } catch (error) {
    console.log("❌ YAML syntax error:", error.message);
  }
}

testDockerComposeParsing();
