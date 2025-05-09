/**
 * EDF (European Data Format) Parser for EEG data
 * This is a simplified implementation for demonstration purposes
 */

import type { EEGData } from "shared/components/eeg-dashboard";

export async function parseEDFFile(file: File): Promise<EEGData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        if (!event.target || !event.target.result) {
          throw new Error("Failed to read file");
        }

        const buffer = event.target.result as ArrayBuffer;
        console.log(
          `File loaded: ${file.name}, size: ${buffer.byteLength} bytes`
        );

        if (buffer.byteLength < 256) {
          throw new Error("File is too small to be a valid EDF file");
        }
      } catch (error) {
        console.error("Error parsing EDF file:", error);
      }
    };

    reader.onerror = (event) => {
      console.error("File reader error:", event);
      reject(new Error("Error reading file"));
    };

    reader.readAsArrayBuffer(file);
  });
}

// Create simulated EEG data based on the filename
function createSimulatedEEGData(filename: string): EEGData {
  // Generate a deterministic number of channels based on the filename
  const filenameHash = filename
    .split("")
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const channelCount = 8 + (filenameHash % 8); // Between 8 and 15 channels

  // Generate channel names
  const channels: string[] = [];
  for (let i = 0; i < channelCount; i++) {
    // Standard EEG channel names
    const standardChannels = [
      "Fp1",
      "Fp2",
      "F3",
      "F4",
      "C3",
      "C4",
      "P3",
      "P4",
      "O1",
      "O2",
      "F7",
      "F8",
      "T3",
      "T4",
      "T5",
      "T6",
      "Fz",
      "Cz",
      "Pz",
    ];

    if (i < standardChannels.length) {
      channels.push(standardChannels[i]);
    } else {
      channels.push(`CH${i + 1}`);
    }
  }

  // Set sample rate and duration based on filename
  const sampleRate = 500; // Standard EEG sample rate
  const duration = 300 + (filenameHash % 30); // Between 30 and 59 seconds

  // Calculate samples per channel
  const samplesPerChannel = Math.floor(sampleRate * duration);

  // Generate data for each channel
  const data = generateSimulatedEEGData(channelCount, samplesPerChannel);

  // Create a start time
  const startTime = new Date();
  startTime.setHours(startTime.getHours() - 1); // Set to 1 hour ago

  return {
    channels,
    samplesPerChannel,
    sampleRate,
    data,
    startTime,
    duration,
  };
}

// Generate simulated EEG data for demonstration
function generateSimulatedEEGData(
  channelCount: number,
  samplesPerChannel: number
): number[][] {
  const data: number[][] = [];

  for (let channel = 0; channel < channelCount; channel++) {
    const channelData: number[] = [];

    // Base frequency and amplitude varies by channel
    const baseFreq = 1 + (channel % 5) * 2; // 1-9 Hz
    const baseAmp = 10 + (channel % 3) * 5; // 10-20 µV

    // Use a more efficient approach for large datasets
    const samplesPerSegment = 1000;
    const segments = Math.ceil(samplesPerChannel / samplesPerSegment);

    for (let segment = 0; segment < segments; segment++) {
      const segmentStart = segment * samplesPerSegment;
      const segmentEnd = Math.min(
        segmentStart + samplesPerSegment,
        samplesPerChannel
      );

      for (let i = segmentStart; i < segmentEnd; i++) {
        // Create a mix of sine waves to simulate EEG
        let sample = 0;

        // Alpha waves (8-13 Hz)
        sample +=
          baseAmp * Math.sin((2 * Math.PI * baseFreq * i) / samplesPerChannel);

        // Add some beta waves (13-30 Hz)
        sample +=
          (baseAmp / 2) *
          Math.sin((2 * Math.PI * (baseFreq * 2) * i) / samplesPerChannel);

        // Add some theta waves (4-8 Hz)
        sample +=
          (baseAmp / 3) *
          Math.sin((2 * Math.PI * (baseFreq / 2) * i) / samplesPerChannel);

        // Add some random noise
        sample += ((Math.random() - 0.5) * baseAmp) / 4;

        // Add occasional spike/artifact (less frequent to reduce memory usage)
        if (Math.random() < 0.0005) {
          sample +=
            Math.random() * baseAmp * 5 * (Math.random() > 0.5 ? 1 : -1);
        }

        channelData.push(sample);
      }
    }

    data.push(channelData);
  }

  return data;
}
