"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  ScatterChart,
  Scatter,
  Cell,
  Legend,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

interface DDAHeatmapProps {
  data: Array<Array<number | null>>;
  height?: number | string;
}

interface ScatterPoint {
  x: number;
  y: number;
  value: number;
}

// Define a maximum number of points to display to prevent browser freezing
const MAX_POINTS = 3000;

/**
 * A component that renders a 2D array as a heatmap using Recharts.
 * It converts a 2D array into a format suitable for Recharts ScatterChart.
 */
export function DDAHeatmap({ data, height = 400 }: DDAHeatmapProps) {
  const [samplingRate, setSamplingRate] = useState(1); // 1 means show every point, 2 means every other point
  const [pointsDisplayed, setPointsDisplayed] = useState(MAX_POINTS);

  // Convert 2D matrix to scatter plot data format with sampling
  const scatterData = useMemo(() => {
    console.log("DDAHeatmap received data:", {
      type: typeof data,
      isArray: Array.isArray(data),
      length: data?.length,
      sample: data?.slice?.(0, 2),
    });

    if (!data || !Array.isArray(data) || data.length === 0) {
      console.error("Invalid data format for DDAHeatmap:", data);
      return [];
    }

    const result: ScatterPoint[] = [];

    // Check if data is already in the expected format or needs conversion
    if (Array.isArray(data[0])) {
      // Data is a 2D array (matrix), process each row
      console.log(
        "Processing as 2D array, dimensions:",
        data.length,
        "x",
        data[0].length
      );

      // Calculate sampling based on data size to prevent browser freezing
      const estimatedPoints = data.length * (data[0]?.length || 0);
      console.log(`Estimated total points: ${estimatedPoints}`);

      // Only process every Nth point based on sampling rate
      let pointCount = 0;
      for (let i = 0; i < data.length; i += samplingRate) {
        if (!Array.isArray(data[i])) continue;

        for (let j = 0; j < data[i].length; j += samplingRate) {
          const value = data[i][j];
          if (value !== null) {
            result.push({
              x: i, // Time index
              y: j, // Frequency index
              value, // The value at this position
            });

            pointCount++;
            if (pointCount >= pointsDisplayed) {
              console.log(
                `Reached maximum points (${pointsDisplayed}), stopping processing`
              );
              break;
            }
          }
        }

        if (pointCount >= pointsDisplayed) {
          break;
        }
      }
    } else {
      // Data is in a different format, try to convert
      console.warn("Data not in expected 2D array format, trying to adapt");
      try {
        // If data is a string, try to parse it
        const parsedData = typeof data === "string" ? JSON.parse(data) : data;

        if (Array.isArray(parsedData)) {
          // Process as 1D array of objects or values
          let pointCount = 0;
          for (let i = 0; i < parsedData.length; i += samplingRate) {
            const item = parsedData[i];
            if (typeof item === "object" && item !== null) {
              // If item has x, y, value properties
              if ("x" in item && "y" in item && "value" in item) {
                result.push({
                  x: Number(item.x),
                  y: Number(item.y),
                  value: Number(item.value),
                });
              }
            } else if (typeof item === "number") {
              // Handle 1D array of values
              result.push({
                x: i,
                y: 0,
                value: item,
              });
            }

            pointCount++;
            if (pointCount >= pointsDisplayed) {
              break;
            }
          }
        }
      } catch (error) {
        console.error("Failed to convert data format:", error);
      }
    }

    console.log(`Processed ${result.length} data points for heatmap`);
    return result;
  }, [data, samplingRate, pointsDisplayed]);

  // Calculate min and max values for color scaling
  const { minValue, maxValue } = useMemo(() => {
    if (scatterData.length === 0) return { minValue: 0, maxValue: 1 };

    let min = Infinity;
    let max = -Infinity;

    for (const point of scatterData) {
      if (point.value < min) min = point.value;
      if (point.value > max) max = point.value;
    }

    return { minValue: min, maxValue: max };
  }, [scatterData]);

  // Estimate total points in dataset
  const totalPoints = useMemo(() => {
    if (!data || !Array.isArray(data)) return 0;
    let count = 0;
    for (const row of data) {
      if (Array.isArray(row)) {
        for (const val of row) {
          if (val !== null) count++;
        }
      }
    }
    return count;
  }, [data]);

  // Handle increasing sampling rate
  const increaseSampling = () => {
    setSamplingRate((prev) => Math.min(prev + 1, 10));
  };

  // Handle decreasing sampling rate
  const decreaseSampling = () => {
    setSamplingRate((prev) => Math.max(prev - 1, 1));
  };

  // Handle changing points displayed
  const handlePointsChange = (value: number[]) => {
    setPointsDisplayed(value[0]);
  };

  if (scatterData.length === 0) {
    return (
      <div className="p-4 text-center border rounded bg-muted">
        <p>No valid data available for heatmap visualization</p>
        <p className="text-xs text-muted-foreground mt-2">
          Received data of type: {typeof data}, length:{" "}
          {Array.isArray(data) ? data.length : "N/A"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col space-y-2">
        <div className="flex justify-between items-center">
          <p className="text-sm">
            Showing {scatterData.length} of approximately {totalPoints} points
          </p>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={decreaseSampling}
              disabled={samplingRate <= 1}
            >
              Higher Resolution
            </Button>
            <span className="text-xs">Sampling: {samplingRate}x</span>
            <Button
              variant="outline"
              size="sm"
              onClick={increaseSampling}
              disabled={samplingRate >= 10}
            >
              Lower Resolution
            </Button>
          </div>
        </div>
        <div className="px-2">
          <p className="text-xs mb-1">
            Max points to display: {pointsDisplayed}
          </p>
          <Slider
            value={[pointsDisplayed]}
            min={100}
            max={5000}
            step={100}
            onValueChange={handlePointsChange}
          />
        </div>
      </div>

      <div style={{ width: "100%", height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart
            margin={{
              top: 20,
              right: 30,
              bottom: 40,
              left: 30,
            }}
          >
            <XAxis
              type="number"
              dataKey="x"
              name="Time"
              unit=" s"
              domain={["dataMin", "dataMax"]}
              label={{ value: "Time (s)", position: "bottom" }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name="Frequency"
              unit=" Hz"
              domain={["dataMin", "dataMax"]}
              label={{
                value: "Frequency (Hz)",
                angle: -90,
                position: "insideLeft",
              }}
            />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              formatter={(value: any, name: string) => {
                if (name === "value")
                  return [`${Number(value).toFixed(2)}`, "Value"];
                if (name === "x") return [`${value}`, "Time"];
                if (name === "y") return [`${value}`, "Frequency"];
                return [value, name];
              }}
            />
            <Scatter name="DDA Matrix" data={scatterData} fill="#8884d8">
              {scatterData.map((entry, index) => {
                // Calculate color based on value
                const normalizedValue =
                  (entry.value - minValue) / (maxValue - minValue);

                // Use a better color scale: blue (cold) to red (hot)
                const r = Math.floor(normalizedValue * 255);
                const g = Math.floor(
                  Math.max(0, (0.5 - Math.abs(normalizedValue - 0.5)) * 255 * 2)
                );
                const b = Math.floor((1 - normalizedValue) * 255);
                const color = `rgb(${r}, ${g}, ${b})`;

                return (
                  <Cell
                    key={`cell-${index}`}
                    fill={color}
                    r={2} // Smaller fixed size for better performance
                  />
                );
              })}
            </Scatter>
            <Legend />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
