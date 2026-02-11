"use client";

import { useEffect, useRef, memo } from "react";
import * as echarts from "echarts";
import { COMPARE_COLORS } from "./CompareEntryList";
import type { ChannelTestResult } from "@/hooks/useGroupStatistics";

interface CompareBoxPlotsProps {
  results: ChannelTestResult[];
  groupALabel: string;
  groupBLabel: string;
  alpha: number;
}

export function CompareBoxPlots({
  results,
  groupALabel,
  groupBLabel,
  alpha,
}: CompareBoxPlotsProps) {
  if (results.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
        No channels with sufficient data for both groups
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {results.map((result) => (
        <ChannelBoxPlot
          key={result.channel}
          result={result}
          groupALabel={groupALabel}
          groupBLabel={groupBLabel}
          alpha={alpha}
        />
      ))}
    </div>
  );
}

interface ChannelBoxPlotProps {
  result: ChannelTestResult;
  groupALabel: string;
  groupBLabel: string;
  alpha: number;
}

const ChannelBoxPlot = memo(function ChannelBoxPlot({
  result,
  groupALabel,
  groupBLabel,
  alpha,
}: ChannelBoxPlotProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;

    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(chartRef.current, undefined, {
        renderer: "canvas",
      });

      const resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(() => chartInstanceRef.current?.resize());
      });
      resizeObserver.observe(chartRef.current);

      const el = chartRef.current;
      return () => {
        resizeObserver.disconnect();
        chartInstanceRef.current?.dispose();
        chartInstanceRef.current = null;
      };
    }
  }, []);

  useEffect(() => {
    if (!chartInstanceRef.current) return;

    const { groupA, groupB, correctedPValue, channel } = result;
    const sig = correctedPValue < alpha;

    const pText =
      correctedPValue < 0.001
        ? "p < 0.001"
        : `p = ${correctedPValue.toFixed(4)}`;

    // Jitter individual data points
    const jitter = (groupIdx: number, values: number[]) =>
      values.map((v) => [groupIdx + (Math.random() - 0.5) * 0.3, v]);

    const option: echarts.EChartsOption = {
      title: {
        text: channel,
        subtext: `${pText}${sig ? " *" : ""}`,
        left: "center",
        top: 4,
        textStyle: { fontSize: 12, fontWeight: 600 },
        subtextStyle: {
          fontSize: 10,
          color: sig ? "#ef4444" : "#71717a",
        },
      },
      tooltip: { trigger: "item" },
      grid: { left: 50, right: 16, top: 52, bottom: 32 },
      xAxis: {
        type: "category",
        data: [groupALabel, groupBLabel],
        axisLabel: { fontSize: 10 },
      },
      yAxis: {
        type: "value",
        axisLabel: { fontSize: 9 },
        splitLine: { lineStyle: { type: "dashed", opacity: 0.3 } },
      },
      series: [
        {
          type: "boxplot",
          data: [
            [groupA.min, groupA.q1, groupA.median, groupA.q3, groupA.max],
            [groupB.min, groupB.q1, groupB.median, groupB.q3, groupB.max],
          ],
          itemStyle: {
            borderWidth: 1.5,
          },
          encode: { tooltip: [1, 2, 3, 4, 5] },
          colorBy: "data" as any,
          color: [COMPARE_COLORS[0], COMPARE_COLORS[1]],
        } as any,
        {
          type: "scatter",
          data: jitter(0, groupA.values),
          symbolSize: 5,
          itemStyle: {
            color: COMPARE_COLORS[0],
            opacity: 0.5,
          },
        },
        {
          type: "scatter",
          data: jitter(1, groupB.values),
          symbolSize: 5,
          itemStyle: {
            color: COMPARE_COLORS[1],
            opacity: 0.5,
          },
        },
      ],
    };

    chartInstanceRef.current.setOption(option, true);
  }, [result, groupALabel, groupBLabel, alpha]);

  return (
    <div className="border rounded-lg p-2">
      <div ref={chartRef} style={{ height: 220 }} />
    </div>
  );
});
