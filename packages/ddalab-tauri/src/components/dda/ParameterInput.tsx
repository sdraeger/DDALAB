"use client"

import React, { useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { InfoTooltip } from "@/components/ui/info-tooltip"
import { cn } from "@/lib/utils"

type TimeUnit = "samples" | "ms" | "s"

interface ParameterInputProps {
  label: string
  value: number // Always in samples
  onChange: (samples: number) => void
  sampleRate: number // Hz
  disabled?: boolean
  min?: number // In samples
  max?: number // In samples
  step?: number // In samples
  tooltip?: React.ReactNode
  className?: string
  defaultUnit?: TimeUnit
  allowedUnits?: TimeUnit[]
}

export function ParameterInput({
  label,
  value,
  onChange,
  sampleRate,
  disabled = false,
  min,
  max,
  step = 1,
  tooltip,
  className,
  defaultUnit = "samples",
  allowedUnits = ["samples", "ms", "s"],
}: ParameterInputProps) {
  const [unit, setUnit] = useState<TimeUnit>(defaultUnit)
  const [displayValue, setDisplayValue] = useState<string>("")

  // Convert samples to the current unit
  const samplesToUnit = (samples: number, targetUnit: TimeUnit): number => {
    switch (targetUnit) {
      case "samples":
        return samples
      case "ms":
        return (samples / sampleRate) * 1000
      case "s":
        return samples / sampleRate
    }
  }

  // Convert from current unit to samples
  const unitToSamples = (val: number, fromUnit: TimeUnit): number => {
    switch (fromUnit) {
      case "samples":
        return Math.round(val)
      case "ms":
        return Math.round((val / 1000) * sampleRate)
      case "s":
        return Math.round(val * sampleRate)
    }
  }

  // Update display value when value or unit changes
  useEffect(() => {
    const converted = samplesToUnit(value, unit)
    setDisplayValue(converted.toFixed(unit === "samples" ? 0 : 3))
  }, [value, unit, sampleRate])

  const handleValueChange = (inputValue: string) => {
    setDisplayValue(inputValue)

    const numericValue = parseFloat(inputValue)
    if (isNaN(numericValue)) return

    const samplesValue = unitToSamples(numericValue, unit)

    // Apply min/max constraints in samples
    let constrainedValue = samplesValue
    if (min !== undefined) constrainedValue = Math.max(min, constrainedValue)
    if (max !== undefined) constrainedValue = Math.min(max, constrainedValue)

    onChange(constrainedValue)
  }

  const handleUnitChange = (newUnit: TimeUnit) => {
    setUnit(newUnit)
    // Display value will be updated by the useEffect
  }

  const getStepForUnit = (): string => {
    switch (unit) {
      case "samples":
        return step.toString()
      case "ms":
        return "0.1"
      case "s":
        return "0.001"
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2">
        <Label className="text-sm">{label}</Label>
        {tooltip && <InfoTooltip content={tooltip} />}
      </div>
      <div className="flex gap-2">
        <Input
          type="number"
          value={displayValue}
          onChange={(e) => handleValueChange(e.target.value)}
          disabled={disabled}
          step={getStepForUnit()}
          className="flex-1"
        />
        <Select value={unit} onValueChange={handleUnitChange} disabled={disabled}>
          <SelectTrigger className="w-[100px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allowedUnits.includes("samples") && (
              <SelectItem value="samples">samples</SelectItem>
            )}
            {allowedUnits.includes("ms") && (
              <SelectItem value="ms">ms</SelectItem>
            )}
            {allowedUnits.includes("s") && (
              <SelectItem value="s">s</SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground">
        = {value} samples ({(value / sampleRate).toFixed(3)}s)
      </p>
    </div>
  )
}
