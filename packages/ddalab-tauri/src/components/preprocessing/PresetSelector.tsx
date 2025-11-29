/**
 * PresetSelector Component
 *
 * Dropdown for selecting and saving preprocessing presets
 */

import React, { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { PipelinePreset } from "@/types/preprocessing";
import { ChevronDown, Save, Sparkles, User, Zap } from "lucide-react";

interface PresetSelectorProps {
  presets: PipelinePreset[];
  onSelect: (presetId: string) => void;
  onSave: (name: string, description?: string) => string;
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  eeg: <Zap className="h-4 w-4" />,
  meg: <Sparkles className="h-4 w-4" />,
  custom: <User className="h-4 w-4" />,
};

export function PresetSelector({
  presets,
  onSelect,
  onSave,
}: PresetSelectorProps) {
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [presetDescription, setPresetDescription] = useState("");

  const builtInPresets = presets.filter((p) => p.isBuiltIn);
  const customPresets = presets.filter((p) => !p.isBuiltIn);

  const handleSave = () => {
    if (presetName.trim()) {
      onSave(presetName.trim(), presetDescription.trim() || undefined);
      setPresetName("");
      setPresetDescription("");
      setSaveDialogOpen(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Sparkles className="h-4 w-4 mr-1.5" />
            Presets
            <ChevronDown className="h-4 w-4 ml-1.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Built-in Presets</DropdownMenuLabel>
          <DropdownMenuGroup>
            {builtInPresets.map((preset) => (
              <DropdownMenuItem
                key={preset.id}
                onClick={() => onSelect(preset.id)}
                className="flex items-start gap-2 py-2"
              >
                <div className="mt-0.5">
                  {CATEGORY_ICONS[preset.category] ?? (
                    <Zap className="h-4 w-4" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{preset.name}</span>
                    <Badge variant="secondary" className="text-[10px] px-1.5">
                      {preset.category}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {preset.description}
                  </p>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>

          {customPresets.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Custom Presets</DropdownMenuLabel>
              <DropdownMenuGroup>
                {customPresets.map((preset) => (
                  <DropdownMenuItem
                    key={preset.id}
                    onClick={() => onSelect(preset.id)}
                    className="flex items-start gap-2 py-2"
                  >
                    <div className="mt-0.5">
                      <User className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{preset.name}</span>
                      {preset.description && (
                        <p className="text-xs text-muted-foreground line-clamp-1">
                          {preset.description}
                        </p>
                      )}
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setSaveDialogOpen(true)}>
            <Save className="h-4 w-4 mr-2" />
            Save Current as Preset
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Save Preset Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as Preset</DialogTitle>
            <DialogDescription>
              Save the current pipeline configuration as a reusable preset.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="preset-name">Name</Label>
              <Input
                id="preset-name"
                placeholder="My Custom Preset"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="preset-description">Description (optional)</Label>
              <Input
                id="preset-description"
                placeholder="Describe this preset..."
                value={presetDescription}
                onChange={(e) => setPresetDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!presetName.trim()}>
              Save Preset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
