"use client";

import * as React from "react";
import * as RechartsPrimitive from "recharts";
import { cn } from "shared/lib/utils/misc";

interface ChartProps
  extends React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer> {}

const Chart = React.forwardRef<
  React.ElementRef<typeof RechartsPrimitive.ResponsiveContainer>,
  ChartProps
>(({ className, children, ...props }, ref) => (
  <RechartsPrimitive.ResponsiveContainer
    width="100%"
    height={350}
    className={cn("", className)}
    {...props}
    ref={ref}
  >
    {children}
  </RechartsPrimitive.ResponsiveContainer>
));
Chart.displayName = "Chart";

const ChartTooltip = RechartsPrimitive.Tooltip;
const ChartLegend = RechartsPrimitive.Legend;

export { Chart, ChartTooltip, ChartLegend };
