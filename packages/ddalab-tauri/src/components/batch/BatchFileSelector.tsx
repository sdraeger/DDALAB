"use client";

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Folder,
  FolderOpen,
  FolderSearch,
  X,
  FileText,
  HardDrive,
  Loader2,
  ChevronRight,
  ChevronDown,
  Database,
} from "lucide-react";
import { useDirectoryListing } from "@/hooks/useFileManagement";
import { useBIDSMultipleDetections } from "@/hooks/useBIDSQuery";
import { discoverSubjects } from "@/services/bids/reader";
import type { BIDSSubject } from "@/services/bids/reader";
import { tauriBackendService } from "@/services/tauriBackendService";
import { useAppStore } from "@/store/appStore";
import { SUPPORTED_EXTENSIONS } from "@/components/file-manager";

interface BatchFileSelectorProps {
  files: string[];
  onFilesChange: (files: string[]) => void;
  disabled?: boolean;
}

interface BIDSDatasetExpanded {
  path: string;
  subjects: BIDSSubject[];
  loading: boolean;
}

interface DirContents {
  files: Array<{ name: string; path: string; size?: number }>;
  dirs: Array<{ name: string; path: string }>;
}

/** Recursively browsable folder row rendered inside a Table */
function FolderNode({
  name,
  path,
  selectedSet,
  onToggleFile,
  disabled,
  depth = 0,
}: {
  name: string;
  path: string;
  selectedSet: Set<string>;
  onToggleFile: (filePath: string, checked: boolean) => void;
  disabled: boolean;
  depth?: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [contents, setContents] = useState<DirContents | null>(null);
  const [loading, setLoading] = useState(false);

  const handleToggle = useCallback(async () => {
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    setIsOpen(true);
    if (!contents) {
      setLoading(true);
      try {
        const listing = await tauriBackendService.listDirectory(path);
        const files = listing.entries
          .filter(
            (e) =>
              !e.isDirectory &&
              !e.isAnnexPlaceholder &&
              SUPPORTED_EXTENSIONS.some((ext) =>
                e.name.toLowerCase().endsWith(ext),
              ),
          )
          .map((e) => ({ name: e.name, path: e.path, size: e.size }));
        const dirs = listing.entries
          .filter((e) => e.isDirectory && !e.name.startsWith("."))
          .map((e) => ({ name: e.name, path: e.path }));
        setContents({ files, dirs });
      } catch {
        setContents({ files: [], dirs: [] });
      } finally {
        setLoading(false);
      }
    }
  }, [isOpen, contents, path]);

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        onClick={() => !disabled && handleToggle()}
      >
        <TableCell className="py-1.5" />
        <TableCell className="py-1.5" colSpan={2}>
          <div
            className="flex items-center gap-2"
            style={{ paddingLeft: depth * 20 }}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : isOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            {isOpen ? (
              <FolderOpen className="h-3.5 w-3.5 text-amber-500" />
            ) : (
              <Folder className="h-3.5 w-3.5 text-amber-500" />
            )}
            <span className="text-xs font-medium">{name}</span>
            {contents && !loading && (
              <span className="text-xs text-muted-foreground">
                {contents.files.length > 0 &&
                  `${contents.files.length} file${contents.files.length === 1 ? "" : "s"}`}
                {contents.files.length > 0 && contents.dirs.length > 0 && ", "}
                {contents.dirs.length > 0 &&
                  `${contents.dirs.length} folder${contents.dirs.length === 1 ? "" : "s"}`}
                {contents.files.length === 0 &&
                  contents.dirs.length === 0 &&
                  "empty"}
              </span>
            )}
          </div>
        </TableCell>
      </TableRow>
      {isOpen &&
        contents &&
        contents.dirs.map((dir) => (
          <FolderNode
            key={dir.path}
            name={dir.name}
            path={dir.path}
            selectedSet={selectedSet}
            onToggleFile={onToggleFile}
            disabled={disabled}
            depth={depth + 1}
          />
        ))}
      {isOpen &&
        contents &&
        contents.files.map((file) => {
          const isChecked = selectedSet.has(file.path);
          return (
            <TableRow
              key={file.path}
              className="cursor-pointer"
              onClick={() => !disabled && onToggleFile(file.path, !isChecked)}
            >
              <TableCell className="py-1.5">
                <Checkbox
                  checked={isChecked}
                  onCheckedChange={(checked) =>
                    onToggleFile(file.path, checked === true)
                  }
                  disabled={disabled}
                  onClick={(e) => e.stopPropagation()}
                />
              </TableCell>
              <TableCell className="py-1.5 font-mono text-xs">
                <span style={{ paddingLeft: (depth + 1) * 20 }}>
                  {file.name}
                </span>
              </TableCell>
              <TableCell className="py-1.5 text-xs text-muted-foreground text-right">
                {file.size ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : "—"}
              </TableCell>
            </TableRow>
          );
        })}
    </>
  );
}

export function BatchFileSelector({
  files,
  onFilesChange,
  disabled = false,
}: BatchFileSelectorProps) {
  const dataDirectoryPath = useAppStore((s) => s.fileManager.dataDirectoryPath);
  const { data: directoryListing, isLoading: isLoadingDir } =
    useDirectoryListing(dataDirectoryPath || "", !!dataDirectoryPath);

  // Separate directories and data files from the listing
  const { directories, dataFiles } = useMemo(() => {
    if (!directoryListing?.files) return { directories: [], dataFiles: [] };
    const dirs = directoryListing.files
      .filter((e) => e.is_directory)
      .map((e) => ({ name: e.name, path: e.path }));
    const files = directoryListing.files.filter(
      (e) =>
        !e.is_directory &&
        !e.is_annex_placeholder &&
        SUPPORTED_EXTENSIONS.some((ext) => e.name.toLowerCase().endsWith(ext)),
    );
    return { directories: dirs, dataFiles: files };
  }, [directoryListing]);

  // BIDS detection for all directories
  const bidsResults = useBIDSMultipleDetections(directories);

  const bidsDatasets = useMemo(
    () =>
      bidsResults
        .filter((r) => r.isSuccess && r.data?.isBIDS)
        .map((r) => r.data!),
    [bidsResults],
  );

  // Non-BIDS directories that should be browsable
  const nonBidsDirectories = useMemo(() => {
    const bidsPaths = new Set(bidsDatasets.map((d) => d.path));
    return directories.filter(
      (d) => !bidsPaths.has(d.path) && !d.name.startsWith("."),
    );
  }, [directories, bidsDatasets]);

  // Track expanded BIDS datasets and their discovered subjects
  const [expandedBIDS, setExpandedBIDS] = useState<
    Record<string, BIDSDatasetExpanded>
  >({});

  const selectedSet = useMemo(() => new Set(files), [files]);

  // Expand a BIDS dataset to discover subjects/sessions/runs
  const handleToggleBIDS = useCallback(
    async (datasetPath: string) => {
      if (expandedBIDS[datasetPath] && !expandedBIDS[datasetPath].loading) {
        // Collapse
        setExpandedBIDS((prev) => {
          const next = { ...prev };
          delete next[datasetPath];
          return next;
        });
        return;
      }
      // Expand — discover subjects
      setExpandedBIDS((prev) => ({
        ...prev,
        [datasetPath]: { path: datasetPath, subjects: [], loading: true },
      }));
      try {
        const subjects = await discoverSubjects(datasetPath);
        setExpandedBIDS((prev) => ({
          ...prev,
          [datasetPath]: { path: datasetPath, subjects, loading: false },
        }));
      } catch {
        setExpandedBIDS((prev) => ({
          ...prev,
          [datasetPath]: { path: datasetPath, subjects: [], loading: false },
        }));
      }
    },
    [expandedBIDS],
  );

  // Collect all data file paths from a BIDS dataset
  const getBIDSDatasetFiles = useCallback(
    (datasetPath: string): string[] => {
      const expanded = expandedBIDS[datasetPath];
      if (!expanded) return [];
      return expanded.subjects.flatMap((sub) =>
        sub.sessions.flatMap((ses) => ses.runs.map((run) => run.dataFile)),
      );
    },
    [expandedBIDS],
  );

  // Select all files from a BIDS dataset
  const handleSelectAllBIDS = useCallback(
    (datasetPath: string) => {
      const bidsFiles = getBIDSDatasetFiles(datasetPath);
      const newPaths = bidsFiles.filter((p) => !selectedSet.has(p));
      if (newPaths.length > 0) {
        onFilesChange([...files, ...newPaths]);
      }
    },
    [getBIDSDatasetFiles, selectedSet, files, onFilesChange],
  );

  // Deselect all files from a BIDS dataset
  const handleDeselectAllBIDS = useCallback(
    (datasetPath: string) => {
      const bidsFiles = new Set(getBIDSDatasetFiles(datasetPath));
      onFilesChange(files.filter((f) => !bidsFiles.has(f)));
    },
    [getBIDSDatasetFiles, files, onFilesChange],
  );

  // Toggle a single file
  const handleToggleFile = useCallback(
    (filePath: string, checked: boolean) => {
      if (checked) {
        onFilesChange([...files, filePath]);
      } else {
        onFilesChange(files.filter((f) => f !== filePath));
      }
    },
    [files, onFilesChange],
  );

  // Select/deselect all top-level data files
  const handleSelectAllDataFiles = useCallback(() => {
    const newPaths = dataFiles
      .map((f) => f.path)
      .filter((p) => !selectedSet.has(p));
    if (newPaths.length > 0) {
      onFilesChange([...files, ...newPaths]);
    }
  }, [dataFiles, files, selectedSet, onFilesChange]);

  const handleDeselectAllDataFiles = useCallback(() => {
    const dataFilePaths = new Set(dataFiles.map((f) => f.path));
    onFilesChange(files.filter((f) => !dataFilePaths.has(f)));
  }, [dataFiles, files, onFilesChange]);

  // Browse external files
  const handleAddFiles = useCallback(async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: true,
      filters: [
        {
          name: "Neurophysiology Data",
          extensions: [
            "edf",
            "set",
            "vhdr",
            "fif",
            "csv",
            "txt",
            "nii",
            "nii.gz",
            "xdf",
            "nwb",
          ],
        },
      ],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    const newFiles = [...files, ...paths.filter((p) => !selectedSet.has(p))];
    onFilesChange(newFiles);
  }, [files, selectedSet, onFilesChange]);

  // Browse BIDS directory externally
  const handleAddBIDSDirectory = useCallback(async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true });
    if (!selected) return;

    try {
      const subjects = await discoverSubjects(selected);
      const bidsFiles = subjects.flatMap((sub) =>
        sub.sessions.flatMap((ses) => ses.runs.map((run) => run.dataFile)),
      );
      const newFiles = [
        ...files,
        ...bidsFiles.filter((p) => !selectedSet.has(p)),
      ];
      onFilesChange(newFiles);
    } catch {
      // Fallback: use invoke for non-BIDS directories
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        const discovered = await invoke<string[]>("discover_bids_files", {
          directory: selected,
        });
        onFilesChange([
          ...files,
          ...discovered.filter((p) => !selectedSet.has(p)),
        ]);
      } catch {
        onFilesChange([...files, selected]);
      }
    }
  }, [files, selectedSet, onFilesChange]);

  const handleRemoveFile = useCallback(
    (index: number) => {
      onFilesChange(files.filter((_, i) => i !== index));
    },
    [files, onFilesChange],
  );

  const handleClearAll = useCallback(() => {
    onFilesChange([]);
  }, [onFilesChange]);

  const getFileName = (filePath: string) =>
    filePath.split("/").pop() || filePath;

  const getFileDirectory = (filePath: string) => {
    const parts = filePath.split("/");
    parts.pop();
    const dir = parts.join("/");
    return dir.length > 60 ? "..." + dir.slice(-57) : dir;
  };

  const dataFileSelectedCount = dataFiles.filter((f) =>
    selectedSet.has(f.path),
  ).length;
  const allDataFilesSelected =
    dataFiles.length > 0 && dataFileSelectedCount === dataFiles.length;
  const isLoading = isLoadingDir || bidsResults.some((r) => r.isLoading);

  return (
    <div className="space-y-4">
      {/* Data Directory Section */}
      {dataDirectoryPath && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <HardDrive className="h-5 w-5 text-primary" />
                <div>
                  <CardTitle className="text-base">Data Directory</CardTitle>
                  <CardDescription className="text-sm truncate max-w-md">
                    {dataDirectoryPath}
                  </CardDescription>
                </div>
              </div>
              {isLoading && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* BIDS Datasets */}
            {bidsDatasets.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                  BIDS Datasets
                </h4>
                {bidsDatasets.map((dataset) => {
                  const expanded = expandedBIDS[dataset.path];
                  const isExpanded = !!expanded && !expanded.loading;
                  const bidsFiles = isExpanded
                    ? getBIDSDatasetFiles(dataset.path)
                    : [];
                  const bidsSelectedCount = bidsFiles.filter((f) =>
                    selectedSet.has(f),
                  ).length;

                  return (
                    <Collapsible
                      key={dataset.path}
                      open={!!expanded}
                      onOpenChange={() => handleToggleBIDS(dataset.path)}
                    >
                      <div className="rounded-lg border">
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            className="flex items-center justify-between w-full px-4 py-3 hover:bg-muted/50 transition-colors text-left"
                            disabled={disabled}
                          >
                            <div className="flex items-center gap-3">
                              {expanded?.loading ? (
                                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                              ) : isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )}
                              <Database className="h-4 w-4 text-purple-500" />
                              <div>
                                <span className="text-sm font-medium">
                                  {dataset.bidsInfo?.datasetName ||
                                    dataset.name}
                                </span>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <Badge variant="outline" className="text-xs">
                                    BIDS
                                  </Badge>
                                  {dataset.bidsInfo?.subjectCount && (
                                    <span className="text-xs text-muted-foreground">
                                      {dataset.bidsInfo.subjectCount} subjects
                                    </span>
                                  )}
                                  {dataset.bidsInfo?.runCount && (
                                    <span className="text-xs text-muted-foreground">
                                      {dataset.bidsInfo.runCount} runs
                                    </span>
                                  )}
                                  {dataset.bidsInfo?.modalities?.map((mod) => (
                                    <Badge
                                      key={mod}
                                      variant="secondary"
                                      className="text-xs uppercase"
                                    >
                                      {mod}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            </div>
                            {isExpanded && bidsFiles.length > 0 && (
                              <Badge variant="secondary">
                                {bidsSelectedCount} / {bidsFiles.length}
                              </Badge>
                            )}
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          {expanded?.loading ? (
                            <div className="px-4 pb-3 flex items-center gap-2 text-muted-foreground">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              <span className="text-xs">
                                Scanning dataset...
                              </span>
                            </div>
                          ) : isExpanded && expanded.subjects.length > 0 ? (
                            <div className="border-t px-4 py-3 space-y-3">
                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSelectAllBIDS(dataset.path);
                                  }}
                                  disabled={
                                    disabled ||
                                    bidsSelectedCount === bidsFiles.length
                                  }
                                >
                                  Select All Runs
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeselectAllBIDS(dataset.path);
                                  }}
                                  disabled={disabled || bidsSelectedCount === 0}
                                >
                                  Deselect All
                                </Button>
                              </div>
                              <div className="max-h-56 overflow-y-auto rounded-md border">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="w-8" />
                                      <TableHead className="w-24">
                                        Subject
                                      </TableHead>
                                      <TableHead className="w-24">
                                        Session
                                      </TableHead>
                                      <TableHead>Task / Run</TableHead>
                                      <TableHead className="w-16">
                                        Modality
                                      </TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {expanded.subjects.flatMap((subject) =>
                                      subject.sessions.flatMap((session) =>
                                        session.runs.map((run) => {
                                          const isChecked = selectedSet.has(
                                            run.dataFile,
                                          );
                                          return (
                                            <TableRow
                                              key={run.dataFile}
                                              className="cursor-pointer"
                                              onClick={() =>
                                                !disabled &&
                                                handleToggleFile(
                                                  run.dataFile,
                                                  !isChecked,
                                                )
                                              }
                                            >
                                              <TableCell className="py-1.5">
                                                <Checkbox
                                                  checked={isChecked}
                                                  onCheckedChange={(checked) =>
                                                    handleToggleFile(
                                                      run.dataFile,
                                                      checked === true,
                                                    )
                                                  }
                                                  disabled={disabled}
                                                  onClick={(e) =>
                                                    e.stopPropagation()
                                                  }
                                                />
                                              </TableCell>
                                              <TableCell className="py-1.5 text-xs font-mono">
                                                {subject.id}
                                              </TableCell>
                                              <TableCell className="py-1.5 text-xs text-muted-foreground">
                                                {session.id || "—"}
                                              </TableCell>
                                              <TableCell className="py-1.5 text-xs">
                                                {run.task}
                                                {run.run !== "01"
                                                  ? ` / run-${run.run}`
                                                  : ""}
                                              </TableCell>
                                              <TableCell className="py-1.5">
                                                <Badge
                                                  variant="secondary"
                                                  className="text-xs uppercase"
                                                >
                                                  {run.modality}
                                                </Badge>
                                              </TableCell>
                                            </TableRow>
                                          );
                                        }),
                                      ),
                                    )}
                                  </TableBody>
                                </Table>
                              </div>
                            </div>
                          ) : isExpanded ? (
                            <div className="border-t px-4 py-3">
                              <p className="text-xs text-muted-foreground">
                                No electrophysiology data files found in this
                                dataset.
                              </p>
                            </div>
                          ) : null}
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  );
                })}
              </div>
            )}

            {/* Files & Folders (non-BIDS) */}
            {(dataFiles.length > 0 || nonBidsDirectories.length > 0) && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                    Files
                  </h4>
                  {dataFiles.length > 0 && (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleSelectAllDataFiles}
                        disabled={disabled || allDataFilesSelected}
                      >
                        Select All
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDeselectAllDataFiles}
                        disabled={disabled || dataFileSelectedCount === 0}
                      >
                        Deselect All
                      </Button>
                    </div>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8" />
                        <TableHead>File</TableHead>
                        <TableHead className="w-24 text-right">Size</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {nonBidsDirectories.map((dir) => (
                        <FolderNode
                          key={dir.path}
                          name={dir.name}
                          path={dir.path}
                          selectedSet={selectedSet}
                          onToggleFile={handleToggleFile}
                          disabled={disabled}
                        />
                      ))}
                      {dataFiles.map((file) => {
                        const isChecked = selectedSet.has(file.path);
                        return (
                          <TableRow
                            key={file.path}
                            className="cursor-pointer"
                            onClick={() =>
                              !disabled &&
                              handleToggleFile(file.path, !isChecked)
                            }
                          >
                            <TableCell className="py-1.5">
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={(checked) =>
                                  handleToggleFile(file.path, checked === true)
                                }
                                disabled={disabled}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </TableCell>
                            <TableCell className="py-1.5 font-mono text-xs">
                              {file.name}
                            </TableCell>
                            <TableCell className="py-1.5 text-xs text-muted-foreground text-right">
                              {file.size
                                ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
                                : "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {!isLoading &&
              dataFiles.length === 0 &&
              nonBidsDirectories.length === 0 &&
              bidsDatasets.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No data files or BIDS datasets found in the data directory.
                </p>
              )}
          </CardContent>
        </Card>
      )}

      {/* Browse externally + summary of selected files */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Selected Files</CardTitle>
              <CardDescription className="text-sm">
                {files.length === 0
                  ? "No files selected"
                  : `${files.length} file${files.length === 1 ? "" : "s"} ready for batch analysis`}
              </CardDescription>
            </div>
            <Badge
              variant={files.length > 0 ? "default" : "secondary"}
              className="text-sm px-3 py-1"
            >
              {files.length}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddFiles}
              disabled={disabled}
            >
              <FolderOpen className="h-4 w-4 mr-2" />
              Browse Files
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddBIDSDirectory}
              disabled={disabled}
            >
              <FolderSearch className="h-4 w-4 mr-2" />
              Scan External BIDS Directory
            </Button>
            {files.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearAll}
                disabled={disabled}
                className="ml-auto text-muted-foreground"
              >
                Clear All
              </Button>
            )}
          </div>

          {files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center border rounded-lg bg-muted/30">
              <FileText className="h-10 w-10 text-muted-foreground mb-3 opacity-40" />
              <p className="text-sm text-muted-foreground">
                Select files from BIDS datasets or the data directory above, or
                browse manually.
              </p>
            </div>
          ) : (
            <div className="max-h-56 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[45%]">File</TableHead>
                    <TableHead>Directory</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {files.map((filePath, index) => (
                    <TableRow key={filePath}>
                      <TableCell className="py-1.5 font-mono text-xs">
                        {getFileName(filePath)}
                      </TableCell>
                      <TableCell className="py-1.5 text-xs text-muted-foreground">
                        {getFileDirectory(filePath)}
                      </TableCell>
                      <TableCell className="py-1.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => handleRemoveFile(index)}
                          disabled={disabled}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
