"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BIDSExportOptions, BIDSOutputFormat } from "@/types/bidsExport";

interface OptionsStepProps {
  options: BIDSExportOptions;
  updateOptions: (updates: Partial<BIDSExportOptions>) => void;
}

export function OptionsStep({ options, updateOptions }: OptionsStepProps) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Export Options</h3>
        <p className="text-sm text-muted-foreground">
          Configure how your data will be exported
        </p>
      </div>

      <div className="grid gap-6">
        <div className="space-y-3">
          <Label>Output Format</Label>
          <RadioGroup
            value={options.outputFormat}
            onValueChange={(value) =>
              updateOptions({ outputFormat: value as BIDSOutputFormat })
            }
            className="flex flex-col gap-3"
          >
            <div className="flex items-start space-x-3">
              <RadioGroupItem value="edf" id="format-edf" />
              <div className="grid gap-1">
                <Label
                  htmlFor="format-edf"
                  className="font-normal cursor-pointer"
                >
                  EDF (European Data Format)
                </Label>
                <p className="text-xs text-muted-foreground">
                  Most widely supported format. Recommended for compatibility.
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <RadioGroupItem value="brainvision" id="format-bv" />
              <div className="grid gap-1">
                <Label
                  htmlFor="format-bv"
                  className="font-normal cursor-pointer"
                >
                  BrainVision (.vhdr/.eeg/.vmrk)
                </Label>
                <p className="text-xs text-muted-foreground">
                  High precision format. Creates three files per recording.
                </p>
              </div>
            </div>
          </RadioGroup>
        </div>

        <div className="space-y-2">
          <Label htmlFor="powerline">Power Line Frequency</Label>
          <Select
            value={options.powerLineFrequency.toString()}
            onValueChange={(value) =>
              updateOptions({ powerLineFrequency: parseInt(value) })
            }
          >
            <SelectTrigger id="powerline" className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="60">60 Hz (Americas, Japan)</SelectItem>
              <SelectItem value="50">50 Hz (Europe, Asia, Africa)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Local AC power frequency for notch filter reference
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="reference">EEG Reference</Label>
          <Input
            id="reference"
            value={options.eegReference || ""}
            onChange={(e) =>
              updateOptions({
                eegReference: e.target.value || undefined,
              })
            }
            placeholder="e.g., Cz, linked mastoids, average"
            className="w-[300px]"
          />
          <p className="text-xs text-muted-foreground">
            Reference electrode or scheme used during recording
          </p>
        </div>
      </div>
    </div>
  );
}
