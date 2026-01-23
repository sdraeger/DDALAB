"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BIDSDatasetMetadata, BIDS_LICENSES } from "@/types/bidsExport";

interface MetadataStepProps {
  metadata: BIDSDatasetMetadata;
  updateMetadata: (updates: Partial<BIDSDatasetMetadata>) => void;
}

export function MetadataStep({ metadata, updateMetadata }: MetadataStepProps) {
  const handleAuthorsChange = (value: string) => {
    const authors = value
      .split(",")
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
    updateMetadata({ authors });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Dataset Metadata</h3>
        <p className="text-sm text-muted-foreground">
          Provide information about your dataset for the
          dataset_description.json
        </p>
      </div>

      <div className="grid gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">
            Dataset Name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="name"
            value={metadata.name}
            onChange={(e) => updateMetadata({ name: e.target.value })}
            placeholder="e.g., My EEG Study"
          />
          <p className="text-xs text-muted-foreground">
            A descriptive name for your dataset
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={metadata.description || ""}
            onChange={(e) => updateMetadata({ description: e.target.value })}
            placeholder="Brief description of the dataset..."
            rows={3}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="authors">Authors</Label>
          <Input
            id="authors"
            value={metadata.authors.join(", ")}
            onChange={(e) => handleAuthorsChange(e.target.value)}
            placeholder="e.g., Jane Doe, John Smith"
          />
          <p className="text-xs text-muted-foreground">
            Comma-separated list of author names
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="license">License</Label>
          <Select
            value={metadata.license}
            onValueChange={(value) => updateMetadata({ license: value })}
          >
            <SelectTrigger id="license">
              <SelectValue placeholder="Select a license" />
            </SelectTrigger>
            <SelectContent>
              {BIDS_LICENSES.map((license) => (
                <SelectItem key={license.value} value={license.value}>
                  {license.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            CC0 is recommended for maximum reusability
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="funding">Funding</Label>
          <Input
            id="funding"
            value={metadata.funding || ""}
            onChange={(e) => updateMetadata({ funding: e.target.value })}
            placeholder="e.g., NIH R01 NS123456"
          />
          <p className="text-xs text-muted-foreground">
            Grant or funding source (optional)
          </p>
        </div>
      </div>
    </div>
  );
}
