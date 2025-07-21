import { EEGData } from "types/EEGData";

/**
 * Processes and stacks raw EEG data for uPlot visualization.
 * @param {EEGData} eegData - The raw EEG data object.
 * @param {string[]} selectedChannels - A list of channel names to display.
 * @returns {object} - An object containing the formatted data for uPlot, and the names of the channels included.
 */
export function stackEegData(
  eegData: EEGData,
  selectedChannels: string[]
): { plotData: number[][]; plotChannels: string[] } {
  // Ensure there is data to process
  if (
    !eegData ||
    !eegData.data ||
    !eegData.channels ||
    eegData.data.length === 0
  ) {
    return { plotData: [[]], plotChannels: [] };
  }

  const { data, channels, sampleRate, samplesPerChannel } = eegData;
  const numPoints = samplesPerChannel || data[0]?.length || 0;

  if (numPoints === 0) {
    return { plotData: [[]], plotChannels: [] };
  }

  // 1. Generate timestamps for the x-axis
  const timestamps = new Array(numPoints);
  const timeIncrement = 1 / sampleRate;
  for (let i = 0; i < numPoints; i++) {
    timestamps[i] = i * timeIncrement;
  }

  // 2. Filter data based on selectedChannels
  const channelMap = new Map(
    channels.map((name: string, i: number) => [name, data[i]])
  );
  const channelsToRender =
    selectedChannels.length > 0 ? selectedChannels : channels;

  const filteredData = channelsToRender
    .map((name: string) => channelMap.get(name))
    .filter((channelData: number[] | undefined) => channelData !== undefined);

  const plotChannels = channelsToRender.filter((name: string) =>
    channelMap.has(name)
  );

  // 3. Find the maximum peak-to-peak amplitude to determine separation
  let maxRange = 0;
  for (const channelData of filteredData) {
    if (channelData.length === 0) continue;

    let min = channelData[0],
      max = channelData[0];
    for (let i = 1; i < channelData.length; i++) {
      if (channelData[i] < min) min = channelData[i];
      if (channelData[i] > max) max = channelData[i];
    }
    const range = max - min;
    if (range > maxRange) {
      maxRange = range;
    }
  }
  // Add a 20% buffer to the separation; use a default if data is flat
  const separation = maxRange === 0 ? 50 : maxRange * 1.2;

  // 4. Create the final stacked data for uPlot
  const plotData = [timestamps];
  for (let i = 0; i < filteredData.length; i++) {
    const verticalOffset = i * separation;
    // Subtracting the offset pushes channels down, which is standard for EEG
    const stackedChannel = filteredData[i].map(
      (val: number) => val - verticalOffset
    );
    plotData.push(stackedChannel);
  }

  return { plotData, plotChannels };
}

export const CHANNEL_COLORS = [
  "#f43f5e",
  "#8b5cf6",
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
  "#6366f1",
  "#ef4444",
  "#14b8a6",
  "#f97316",
];
