import fs from "fs";
import path from "path";

export const DATA_DIRECTORY = path.resolve(__dirname, "../../../data");

export const GENERATED_FIXTURES = {
  SMALL_EDF: path.join(DATA_DIRECTORY, "playwright-small.edf"),
  CSV: path.join(DATA_DIRECTORY, "playwright-timeseries.csv"),
  ASCII: path.join(DATA_DIRECTORY, "playwright-sensors.ascii"),
} as const;

export function getFixtureFileName(filePath: string): string {
  return path.basename(filePath);
}

export function ensureDeterministicFixtures(): void {
  fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
  writeCsvFixture(GENERATED_FIXTURES.CSV);
  writeAsciiFixture(GENERATED_FIXTURES.ASCII);
  writeEdfFixture(GENERATED_FIXTURES.SMALL_EDF);
}

export function cleanupDeterministicFixtures(): void {
  for (const fixturePath of Object.values(GENERATED_FIXTURES)) {
    try {
      if (fs.existsSync(fixturePath)) {
        fs.unlinkSync(fixturePath);
      }
    } catch {
      // Best-effort cleanup. Teardown should not fail if a fixture was removed manually.
    }
  }
}

function writeCsvFixture(filePath: string): void {
  const channelLabels = ["Fp1", "Fp2", "C3", "C4"];
  const rows = buildSignalRows(256, 32);
  const lines = [
    channelLabels.join(","),
    ...rows.map((row) => row.map((value) => value.toFixed(6)).join(",")),
  ];

  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function writeAsciiFixture(filePath: string): void {
  const channelLabels = ["Sensor_A", "Sensor_B", "Sensor_C", "Sensor_D"];
  const rows = buildSignalRows(256, 24);
  const lines = [
    channelLabels.join(" "),
    ...rows.map((row) => row.map((value) => value.toFixed(6)).join(" ")),
  ];

  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function writeEdfFixture(filePath: string): void {
  const labels = ["Fp1", "Fp2", "C3", "C4"];
  const sampleRate = 64;
  const numRecords = 8;
  const recordDurationSeconds = 1;
  const samplesPerRecord = sampleRate * recordDurationSeconds;
  const totalSamples = numRecords * samplesPerRecord;
  const rows = buildSignalRows(totalSamples, sampleRate);
  const physicalMin = -120;
  const physicalMax = 120;
  const digitalMin = -32768;
  const digitalMax = 32767;
  const headerBytes = 256 + labels.length * 256;
  const header = Buffer.alloc(headerBytes, 0x20);
  let offset = 0;

  offset = writeFixedString(header, offset, 8, "0");
  offset = writeFixedString(header, offset, 80, "Playwright");
  offset = writeFixedString(header, offset, 80, "Synthetic DDALAB Fixture");
  offset = writeFixedString(header, offset, 8, "10.03.26");
  offset = writeFixedString(header, offset, 8, "12.00.00");
  offset = writeFixedString(header, offset, 8, String(headerBytes));
  offset = writeFixedString(header, offset, 44, "");
  offset = writeFixedString(header, offset, 8, String(numRecords));
  offset = writeFixedString(header, offset, 8, String(recordDurationSeconds));
  offset = writeFixedString(header, offset, 4, String(labels.length));

  for (const label of labels) {
    offset = writeFixedString(header, offset, 16, label);
  }
  for (let index = 0; index < labels.length; index += 1) {
    offset = writeFixedString(header, offset, 80, "");
  }
  for (let index = 0; index < labels.length; index += 1) {
    offset = writeFixedString(header, offset, 8, "uV");
  }
  for (let index = 0; index < labels.length; index += 1) {
    offset = writeFixedString(header, offset, 8, physicalMin.toFixed(3));
  }
  for (let index = 0; index < labels.length; index += 1) {
    offset = writeFixedString(header, offset, 8, physicalMax.toFixed(3));
  }
  for (let index = 0; index < labels.length; index += 1) {
    offset = writeFixedString(header, offset, 8, String(digitalMin));
  }
  for (let index = 0; index < labels.length; index += 1) {
    offset = writeFixedString(header, offset, 8, String(digitalMax));
  }
  for (let index = 0; index < labels.length; index += 1) {
    offset = writeFixedString(header, offset, 80, "");
  }
  for (let index = 0; index < labels.length; index += 1) {
    offset = writeFixedString(header, offset, 8, String(samplesPerRecord));
  }
  for (let index = 0; index < labels.length; index += 1) {
    offset = writeFixedString(header, offset, 32, "");
  }

  const dataBuffer = Buffer.alloc(totalSamples * labels.length * 2);
  let dataOffset = 0;
  const gain = (physicalMax - physicalMin) / (digitalMax - digitalMin);
  const baselineOffset = physicalMax - gain * digitalMax;

  for (let recordIndex = 0; recordIndex < numRecords; recordIndex += 1) {
    const recordStart = recordIndex * samplesPerRecord;

    for (
      let channelIndex = 0;
      channelIndex < labels.length;
      channelIndex += 1
    ) {
      for (
        let sampleOffset = 0;
        sampleOffset < samplesPerRecord;
        sampleOffset += 1
      ) {
        const rawValue = rows[recordStart + sampleOffset][channelIndex];
        const digitalValue = clampInt16(
          Math.round((rawValue - baselineOffset) / gain),
        );

        dataBuffer.writeInt16LE(digitalValue, dataOffset);
        dataOffset += 2;
      }
    }
  }

  fs.writeFileSync(filePath, Buffer.concat([header, dataBuffer]));
}

function buildSignalRows(sampleCount: number, sampleRate: number): number[][] {
  const rows: number[][] = [];

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const time = sampleIndex / sampleRate;
    rows.push([
      buildSignalValue(time, sampleIndex, 0),
      buildSignalValue(time, sampleIndex, 1),
      buildSignalValue(time, sampleIndex, 2),
      buildSignalValue(time, sampleIndex, 3),
    ]);
  }

  return rows;
}

function buildSignalValue(
  time: number,
  sampleIndex: number,
  channelIndex: number,
): number {
  const baseFrequency = 0.45 + channelIndex * 0.17;
  const harmonicFrequency = 0.12 + channelIndex * 0.05;
  const amplitude = 22 + channelIndex * 4;
  const harmonicAmplitude = 7 + channelIndex * 1.5;
  const drift = (sampleIndex % (17 + channelIndex * 3)) - (8 + channelIndex);

  return (
    amplitude *
      Math.sin(2 * Math.PI * baseFrequency * time + channelIndex * 0.7) +
    harmonicAmplitude *
      Math.cos(2 * Math.PI * harmonicFrequency * time + channelIndex * 0.3) +
    drift * 0.45 +
    channelIndex * 3
  );
}

function writeFixedString(
  buffer: Buffer,
  offset: number,
  size: number,
  value: string,
): number {
  const text = value.slice(0, size).padEnd(size, " ");
  buffer.write(text, offset, size, "ascii");
  return offset + size;
}

function clampInt16(value: number): number {
  return Math.min(32767, Math.max(-32768, value));
}
