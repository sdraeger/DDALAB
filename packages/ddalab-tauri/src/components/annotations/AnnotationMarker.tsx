import React from 'react'
import { PlotAnnotation } from '@/types/annotations'

interface AnnotationMarkerProps {
  annotation: PlotAnnotation
  plotHeight: number
  xPosition: number
  onRightClick: (event: React.MouseEvent, annotation: PlotAnnotation) => void
  onClick?: (annotation: PlotAnnotation) => void
}

export const AnnotationMarker: React.FC<AnnotationMarkerProps> = ({
  annotation,
  plotHeight,
  xPosition,
  onRightClick,
  onClick
}) => {
  const color = annotation.color || '#ef4444' // Default red color

  return (
    <g
      className="annotation-marker cursor-pointer"
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onRightClick(e, annotation)
      }}
      onClick={() => onClick?.(annotation)}
    >
      {/* Vertical line */}
      <line
        x1={xPosition}
        y1={0}
        x2={xPosition}
        y2={plotHeight}
        stroke={color}
        strokeWidth={2}
        strokeDasharray="5,5"
        opacity={0.7}
        className="pointer-events-none"
      />

      {/* Label background */}
      <rect
        x={xPosition + 5}
        y={10}
        rx={3}
        ry={3}
        fill={color}
        opacity={0.9}
        className="pointer-events-none"
        width={annotation.label.length * 7 + 10}
        height={20}
      />

      {/* Label text */}
      <text
        x={xPosition + 10}
        y={23}
        fill="white"
        fontSize="12"
        fontWeight="500"
        className="pointer-events-none select-none"
      >
        {annotation.label}
      </text>

      {/* Hover area for better UX */}
      <rect
        x={xPosition - 5}
        y={0}
        width={10}
        height={plotHeight}
        fill="transparent"
        className="hover:fill-gray-200 hover:fill-opacity-10"
      />
    </g>
  )
}
