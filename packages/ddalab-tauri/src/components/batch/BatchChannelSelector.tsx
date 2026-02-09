"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ChannelSelector } from "@/components/ChannelSelector";
import { tauriBackendService } from "@/services/tauriBackendService";
import { Radio, Regex, List, AlertCircle } from "lucide-react";
import type {
  ChannelSelection,
  ChannelSelectionMode,
} from "@/store/slices/batchSlice";

interface BatchChannelSelectorProps {
  selection: ChannelSelection;
  onSelectionChange: (selection: ChannelSelection) => void;
  selectedFiles: string[];
  disabled?: boolean;
}

/**
 * Loads channel labels from selected files and computes the union
 * of all channel names across files.
 */
function useFileChannels(filePaths: string[]) {
  const [channelsByFile, setChannelsByFile] = useState<
    Record<string, string[]>
  >({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (filePaths.length === 0) {
      setChannelsByFile({});
      return;
    }

    let cancelled = false;
    setLoading(true);

    const loadChannels = async () => {
      const results: Record<string, string[]> = {};
      for (const fp of filePaths) {
        if (cancelled) return;
        // Reuse cached info if already loaded
        if (channelsByFile[fp]) {
          results[fp] = channelsByFile[fp];
          continue;
        }
        try {
          const info = await tauriBackendService.getEdfInfo(fp);
          results[fp] = info.channels;
        } catch {
          results[fp] = [];
        }
      }
      if (!cancelled) {
        setChannelsByFile(results);
        setLoading(false);
      }
    };

    loadChannels();
    return () => {
      cancelled = true;
    };
    // Only re-run when the file list actually changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePaths.join(",")]);

  const allChannelNames = useMemo(() => {
    const set = new Set<string>();
    for (const channels of Object.values(channelsByFile)) {
      for (const ch of channels) set.add(ch);
    }
    return Array.from(set).sort();
  }, [channelsByFile]);

  return { channelsByFile, allChannelNames, loading };
}

/**
 * Computes which channels would be matched by a regex pattern
 * against the union of all channel names.
 */
function usePatternPreview(pattern: string, allChannelNames: string[]) {
  return useMemo(() => {
    if (!pattern.trim()) return { matched: allChannelNames, error: null };
    try {
      const re = new RegExp(pattern, "i");
      return {
        matched: allChannelNames.filter((ch) => re.test(ch)),
        error: null,
      };
    } catch (e) {
      return {
        matched: [],
        error: e instanceof Error ? e.message : "Invalid regex",
      };
    }
  }, [pattern, allChannelNames]);
}

export function BatchChannelSelector({
  selection,
  onSelectionChange,
  selectedFiles,
  disabled = false,
}: BatchChannelSelectorProps) {
  const { allChannelNames, loading } = useFileChannels(selectedFiles);
  const { matched: patternMatched, error: patternError } = usePatternPreview(
    selection.pattern,
    allChannelNames,
  );

  const handleModeChange = useCallback(
    (mode: string) => {
      onSelectionChange({ ...selection, mode: mode as ChannelSelectionMode });
    },
    [selection, onSelectionChange],
  );

  const handlePatternChange = useCallback(
    (pattern: string) => {
      onSelectionChange({ ...selection, pattern });
    },
    [selection, onSelectionChange],
  );

  const handleNamesChange = useCallback(
    (names: string[]) => {
      onSelectionChange({ ...selection, names });
    },
    [selection, onSelectionChange],
  );

  const channelsAvailable = allChannelNames.length > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Channel Selection</CardTitle>
        <CardDescription className="text-xs">
          Choose which channels to include in the analysis
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <RadioGroup
          value={selection.mode}
          onValueChange={handleModeChange}
          disabled={disabled}
          className="space-y-3"
        >
          {/* All Channels */}
          <div className="flex items-start gap-3">
            <RadioGroupItem value="all" id="ch-all" className="mt-0.5" />
            <div className="flex-1">
              <Label
                htmlFor="ch-all"
                className="text-sm font-medium cursor-pointer"
              >
                All Channels
              </Label>
              <p className="text-xs text-muted-foreground">
                Process every channel in each file
              </p>
            </div>
          </div>

          {/* Pattern Match */}
          <div className="flex items-start gap-3">
            <RadioGroupItem
              value="pattern"
              id="ch-pattern"
              className="mt-0.5"
            />
            <div className="flex-1 space-y-2">
              <Label
                htmlFor="ch-pattern"
                className="text-sm font-medium cursor-pointer"
              >
                Match by Pattern (Regex)
              </Label>
              <p className="text-xs text-muted-foreground">
                Select channels whose names match a regular expression
              </p>
              {selection.mode === "pattern" && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Regex className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <Input
                      value={selection.pattern}
                      onChange={(e) => handlePatternChange(e.target.value)}
                      placeholder="e.g. ^EEG|^Fp|Cz|Pz"
                      disabled={disabled}
                      className="font-mono text-sm h-8"
                    />
                  </div>
                  {patternError && (
                    <div className="flex items-center gap-1.5 text-xs text-destructive">
                      <AlertCircle className="h-3 w-3" />
                      {patternError}
                    </div>
                  )}
                  {channelsAvailable && !patternError && (
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground">
                        {selection.pattern.trim()
                          ? `Matches ${patternMatched.length} of ${allChannelNames.length} channels across selected files`
                          : `All ${allChannelNames.length} channels (empty pattern matches all)`}
                      </p>
                      {patternMatched.length > 0 &&
                        patternMatched.length <= 30 && (
                          <div className="flex flex-wrap gap-1">
                            {patternMatched.map((ch) => (
                              <Badge
                                key={ch}
                                variant="secondary"
                                className="text-xs font-mono py-0"
                              >
                                {ch}
                              </Badge>
                            ))}
                          </div>
                        )}
                      {patternMatched.length > 30 && (
                        <p className="text-xs text-muted-foreground italic">
                          Showing count only ({patternMatched.length} channels)
                        </p>
                      )}
                    </div>
                  )}
                  {!channelsAvailable && selectedFiles.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {loading
                        ? "Loading channel names from files..."
                        : "No channel metadata available for preview"}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Select by Name */}
          <div className="flex items-start gap-3">
            <RadioGroupItem value="names" id="ch-names" className="mt-0.5" />
            <div className="flex-1 space-y-2">
              <Label
                htmlFor="ch-names"
                className="text-sm font-medium cursor-pointer"
              >
                Select by Name
              </Label>
              <p className="text-xs text-muted-foreground">
                Pick specific channels from the union of all selected files
              </p>
              {selection.mode === "names" && (
                <div className="space-y-2">
                  {!channelsAvailable && selectedFiles.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {loading
                        ? "Loading channel names from files..."
                        : "Select files first to see available channels"}
                    </p>
                  )}
                  {!channelsAvailable && selectedFiles.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Select files first to see available channels
                    </p>
                  )}
                  {channelsAvailable && (
                    <>
                      <ChannelSelector
                        channels={allChannelNames}
                        selectedChannels={selection.names}
                        onSelectionChange={handleNamesChange}
                        disabled={disabled}
                        label=""
                        variant="compact"
                        showSearch
                        showSelectAll
                        maxHeight="max-h-48"
                      />
                      {selection.names.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {selection.names.length} of {allChannelNames.length}{" "}
                          channels selected
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </RadioGroup>
      </CardContent>
    </Card>
  );
}
