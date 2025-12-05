"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Plus, Trash2 } from "lucide-react";
import { useAppStore, DelayPreset } from "@/store/appStore";

const BUILTIN_PRESETS: DelayPreset[] = [
  {
    id: "eeg-standard",
    name: "EEG Standard",
    description: "Standard delays for EEG analysis",
    delays: [7, 10],
    isBuiltIn: true,
  },
];

interface DelayPresetManagerProps {
  delays: number[];
  onChange: (delays: number[]) => void;
  disabled?: boolean;
  sampleRate?: number;
}

export function DelayPresetManager({
  delays,
  onChange,
  disabled = false,
  sampleRate = 256,
}: DelayPresetManagerProps) {
  const customPresets = useAppStore((state) => state.dda.customDelayPresets);
  const addDelayPreset = useAppStore((state) => state.addDelayPreset);
  const deleteDelayPreset = useAppStore((state) => state.deleteDelayPreset);

  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [isCreatingPreset, setIsCreatingPreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [newPresetDescription, setNewPresetDescription] = useState("");
  const [newPresetDelays, setNewPresetDelays] = useState("");
  const [customListInput, setCustomListInput] = useState("");
  const [hasInvalidInput, setHasInvalidInput] = useState(false);
  const [isUserTyping, setIsUserTyping] = useState(false);

  const allPresets = [...BUILTIN_PRESETS, ...customPresets];

  // Initialize custom list input when loading a preset
  // Only sync when NOT actively typing to avoid feedback loop
  useEffect(() => {
    if (delays && !isUserTyping) {
      setCustomListInput(delays.join(", "));
    }
  }, [delays, isUserTyping]);

  const handlePresetSelect = (presetId: string) => {
    setSelectedPresetId(presetId);
    const preset = allPresets.find((p) => p.id === presetId);
    if (preset) {
      setIsUserTyping(false); // Allow sync from preset
      onChange([...preset.delays]);
      setCustomListInput(preset.delays.join(", "));
    }
  };

  const handleCustomListChange = (input: string) => {
    setIsUserTyping(true);
    setCustomListInput(input);
    setSelectedPresetId(null); // Clear preset selection when manually editing

    // If input is empty, keep empty list
    if (!input.trim()) {
      setHasInvalidInput(false);
      onChange([]);
      return;
    }

    // Parse the comma-separated list - handle various separators
    const tokens = input
      .split(/[,\s]+/) // Split by comma and/or whitespace
      .map((s) => s.trim())
      .filter((s) => s.length > 0); // Remove empty strings

    const validNumbers: number[] = [];
    let hasInvalid = false;

    for (const token of tokens) {
      const num = parseInt(token, 10);
      if (!isNaN(num) && num > 0) {
        validNumbers.push(num);
      } else {
        hasInvalid = true;
      }
    }

    setHasInvalidInput(hasInvalid && validNumbers.length === 0);

    // Remove duplicates and sort
    const parsedDelays = [...new Set(validNumbers)].sort((a, b) => a - b);

    onChange(parsedDelays);
  };

  const handleInputBlur = () => {
    // Only stop typing mode on blur
    setIsUserTyping(false);
  };

  const handleCreatePreset = () => {
    if (!newPresetName.trim()) return;

    const delays = newPresetDelays
      .split(",")
      .map((s) => parseInt(s.trim()))
      .filter((n) => !isNaN(n) && n > 0)
      .sort((a, b) => a - b);

    if (delays.length === 0) return;

    addDelayPreset({
      name: newPresetName.trim(),
      description: newPresetDescription.trim() || "Custom delay preset",
      delays,
    });

    setIsCreatingPreset(false);
    setNewPresetName("");
    setNewPresetDescription("");
    setNewPresetDelays("");

    // Select the newly created preset (it will be the last one)
    setTimeout(() => {
      const newPreset = customPresets[customPresets.length - 1];
      if (newPreset) {
        handlePresetSelect(newPreset.id);
      }
    }, 0);
  };

  const handleDeletePreset = (presetId: string) => {
    deleteDelayPreset(presetId);
    if (selectedPresetId === presetId) {
      setSelectedPresetId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Delay Configuration</CardTitle>
          <InfoTooltip
            content={
              <div className="space-y-1">
                <p className="font-semibold">Delay Parameters (τ)</p>
                <p>Specifies the time lags used in DDA analysis.</p>
                <p className="mt-2 text-xs">
                  Select from built-in presets or create custom delay lists.
                </p>
              </div>
            }
          />
        </div>
        <CardDescription>
          Use a preset or custom list of specific delay values
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-4">
          {/* Preset Selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm">Select Preset</Label>
              <Dialog
                open={isCreatingPreset}
                onOpenChange={setIsCreatingPreset}
              >
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={disabled}>
                    <Plus className="h-4 w-4 mr-1" />
                    New Preset
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create Delay Preset</DialogTitle>
                    <DialogDescription>
                      Define a reusable set of delay values
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label>Preset Name</Label>
                      <Input
                        value={newPresetName}
                        onChange={(e) => setNewPresetName(e.target.value)}
                        placeholder="e.g., My Custom EEG Preset"
                      />
                    </div>
                    <div>
                      <Label>Description (optional)</Label>
                      <Input
                        value={newPresetDescription}
                        onChange={(e) =>
                          setNewPresetDescription(e.target.value)
                        }
                        placeholder="Brief description of this preset"
                      />
                    </div>
                    <div>
                      <Label>Delays (comma-separated)</Label>
                      <Input
                        value={newPresetDelays}
                        onChange={(e) => setNewPresetDelays(e.target.value)}
                        placeholder="e.g., 1, 2, 3, 5, 7, 10, 15, 20"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Enter delay values separated by commas
                      </p>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setIsCreatingPreset(false)}
                    >
                      Cancel
                    </Button>
                    <Button onClick={handleCreatePreset}>Create</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            <Select
              value={selectedPresetId || ""}
              onValueChange={handlePresetSelect}
              disabled={disabled}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a preset or enter custom delays below" />
              </SelectTrigger>
              <SelectContent>
                {allPresets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name} ({preset.delays.length} delays)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedPresetId && (
              <div className="mt-2 p-2 bg-muted/50 rounded-md">
                {(() => {
                  const preset = allPresets.find(
                    (p) => p.id === selectedPresetId,
                  );
                  return preset ? (
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{preset.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {preset.description}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {preset.delays.slice(0, 10).map((delay, idx) => (
                            <Badge
                              key={idx}
                              variant="outline"
                              className="text-xs"
                            >
                              {delay}
                            </Badge>
                          ))}
                          {preset.delays.length > 10 && (
                            <Badge variant="outline" className="text-xs">
                              +{preset.delays.length - 10} more
                            </Badge>
                          )}
                        </div>
                      </div>
                      {!preset.isBuiltIn && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeletePreset(preset.id)}
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ) : null;
                })()}
              </div>
            )}
          </div>

          {/* Custom Delay List */}
          <div>
            <Label className="text-sm">Custom Delay List</Label>
            <Input
              type="text"
              value={customListInput}
              onChange={(e) => handleCustomListChange(e.target.value)}
              onBlur={handleInputBlur}
              disabled={disabled}
              placeholder="e.g., 1, 2, 3, 5, 7, 10, 15, 20"
              className={`font-mono ${hasInvalidInput ? "border-red-500" : ""}`}
            />
            <div className="flex items-start gap-2 mt-1">
              <p className="text-xs text-muted-foreground flex-1">
                {hasInvalidInput ? (
                  <span className="text-red-600">
                    Invalid input. Enter positive numbers separated by commas or
                    spaces.
                  </span>
                ) : delays && delays.length === 0 ? (
                  <span className="text-amber-600">
                    Empty delay list. Enter at least one delay value.
                  </span>
                ) : (
                  "Enter delay values separated by commas or spaces (e.g., 1, 2, 3 or 1 2 3)"
                )}
              </p>
              {customListInput &&
                !hasInvalidInput &&
                delays &&
                delays.length > 0 && (
                  <p className="text-xs text-green-600 font-medium shrink-0">
                    ✓ {delays.length} delay
                    {delays.length === 1 ? "" : "s"}
                  </p>
                )}
            </div>
          </div>

          {/* Preview */}
          {delays && delays.length > 0 && (
            <div>
              <Label className="text-sm">
                Current Delays ({delays.length} total)
              </Label>
              <div className="flex flex-wrap gap-1 mt-2 p-2 bg-muted/30 rounded-md">
                {delays.map((delay, idx) => (
                  <Badge key={idx} variant="secondary" className="text-xs">
                    τ={delay} ({(delay / sampleRate).toFixed(3)}s)
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Summary */}
        <div className="pt-2 border-t">
          <p className="text-sm text-muted-foreground">
            Using {delays?.length || 0} custom delay value
            {delays?.length === 1 ? "" : "s"}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
