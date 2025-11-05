import React from "react";
import { PlotAnnotation } from "@/types/annotations";

interface AnnotationMarkerProps {
  annotation: PlotAnnotation;
  plotHeight: number;
  xPosition: number;
  yOffset?: number;
  onRightClick: (event: React.MouseEvent, annotation: PlotAnnotation) => void;
  onClick?: (annotation: PlotAnnotation) => void;
}

export const AnnotationMarker: React.FC<AnnotationMarkerProps> = ({
  annotation,
  plotHeight,
  xPosition,
  yOffset = 0,
  onRightClick,
  onClick,
}) => {
  const color = annotation.color || "#ef4444"; // Default red color

  return (
    <g
      className="annotation-marker cursor-pointer"
      style={{ pointerEvents: "auto" }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onRightClick(e, annotation);
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick?.(annotation);
      }}
    >
      {/* Vertical line - uses full plot height from bbox */}
      <line
        x1={xPosition}
        y1={yOffset}
        x2={xPosition}
        y2={yOffset + plotHeight}
        stroke={color}
        strokeWidth={2}
        strokeDasharray="5,5"
        opacity={0.7}
        style={{ pointerEvents: "none" }}
      />

      {/* Label background */}
      <rect
        x={xPosition + 5}
        y={yOffset + 10}
        rx={3}
        ry={3}
        fill={color}
        opacity={0.9}
        style={{ pointerEvents: "none" }}
        width={annotation.label.length * 7 + 10}
        height={20}
      />

      {/* Label text */}
      <text
        x={xPosition + 10}
        y={yOffset + 23}
        fill="white"
        fontSize="12"
        fontWeight="500"
        style={{ pointerEvents: "none" }}
        className="select-none"
      >
        {annotation.label}
      </text>

      {/* Clickable area for better UX */}
      <rect
        x={xPosition - 5}
        y={yOffset}
        width={Math.max(10, annotation.label.length * 7 + 20)}
        height={plotHeight}
        fill="transparent"
        style={{ pointerEvents: "auto" }}
      />
    </g>
  );
};
