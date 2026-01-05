"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  Folder,
  Activity,
  User,
  Calendar,
  ChevronRight,
  Loader2,
  AlertCircle,
  CheckCircle,
} from "lucide-react";
import {
  discoverSubjects,
  loadBIDSRun,
  getDatasetSummary,
  type BIDSSubject,
  type BIDSSession,
  type BIDSRun,
  type BIDSDatasetSummary,
} from "@/services/bids/reader";
import {
  validateBIDSDataset,
  readDatasetDescription,
  type BIDSDatasetDescription,
  type BIDSValidationResult,
} from "@/services/bids/validator";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface BIDSBrowserProps {
  datasetPath: string;
  onFileSelect: (filePath: string) => void;
  onClose: () => void;
}

export function BIDSBrowser({
  datasetPath,
  onFileSelect,
  onClose,
}: BIDSBrowserProps) {
  const [loading, setLoading] = useState(true);
  const [subjects, setSubjects] = useState<BIDSSubject[]>([]);
  const [datasetDescription, setDatasetDescription] =
    useState<BIDSDatasetDescription | null>(null);
  const [validationResult, setValidationResult] =
    useState<BIDSValidationResult | null>(null);
  const [datasetSummary, setDatasetSummary] =
    useState<BIDSDatasetSummary | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<BIDSSubject | null>(
    null,
  );
  const [selectedSession, setSelectedSession] = useState<BIDSSession | null>(
    null,
  );
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(
    new Set(),
  );
  const [loadingProgress, setLoadingProgress] = useState<{
    step: string;
    completed: number;
    total: number;
  } | null>(null);

  useEffect(() => {
    loadDataset();
  }, [datasetPath]);

  const loadDataset = async () => {
    setLoading(true);
    setLoadingProgress({
      step: "Reading dataset description...",
      completed: 0,
      total: 4,
    });

    try {
      // Load incrementally to show progress
      const description = await readDatasetDescription(datasetPath);
      setDatasetDescription(description);
      setLoadingProgress({
        step: "Discovering subjects...",
        completed: 1,
        total: 4,
      });

      const discoveredSubjects = await discoverSubjects(datasetPath);
      setSubjects(discoveredSubjects);
      setLoadingProgress({
        step: "Validating BIDS structure...",
        completed: 2,
        total: 4,
      });

      const validation = await validateBIDSDataset(datasetPath);
      setValidationResult(validation);
      setLoadingProgress({
        step: "Loading dataset summary...",
        completed: 3,
        total: 4,
      });

      const summary = await getDatasetSummary(datasetPath);
      setDatasetSummary(summary);
      setLoadingProgress({ step: "Complete", completed: 4, total: 4 });

      if (discoveredSubjects.length > 0 && !selectedSubject) {
        const firstSubject = discoveredSubjects[0];
        setExpandedSubjects(new Set([firstSubject.id]));
      }
    } catch (error) {
      console.error("Failed to load BIDS dataset:", error);
    } finally {
      setLoading(false);
      setLoadingProgress(null);
    }
  };

  const toggleSubject = (subjectId: string) => {
    const newExpanded = new Set(expandedSubjects);
    if (newExpanded.has(subjectId)) {
      newExpanded.delete(subjectId);
    } else {
      newExpanded.add(subjectId);
    }
    setExpandedSubjects(newExpanded);
  };

  const handleRunSelect = async (run: BIDSRun) => {
    try {
      const enrichedRun = await loadBIDSRun(run);
      onFileSelect(enrichedRun.dataFile);
    } catch (error) {
      console.error("Failed to load BIDS run:", error);
    }
  };

  const isFileSupported = (filePath: string): boolean => {
    const lowerPath = filePath.toLowerCase();
    // Check for .nii.gz first (compound extension)
    if (lowerPath.endsWith(".nii.gz")) return true;

    const extension = filePath.split(".").pop()?.toLowerCase();
    return ["edf", "fif", "csv", "txt", "ascii", "vhdr", "set", "nii"].includes(
      extension || "",
    );
  };

  const getModalityColor = (modality: string) => {
    switch (modality) {
      case "eeg":
        return "bg-blue-100 text-blue-700";
      case "ieeg":
        return "bg-purple-100 text-purple-700";
      case "meg":
        return "bg-green-100 text-green-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  if (loading) {
    return (
      <Card className="h-full flex flex-col">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Folder className="h-5 w-5 text-purple-600" />
                BIDS Dataset Browser
              </CardTitle>
              <CardDescription>Loading dataset...</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={onClose}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 w-64">
            <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
            {loadingProgress ? (
              <>
                <p className="text-sm text-muted-foreground text-center">
                  {loadingProgress.step}
                </p>
                <div className="w-full bg-muted rounded-full h-2">
                  <div
                    className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                    style={{
                      width: `${(loadingProgress.completed / loadingProgress.total) * 100}%`,
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Step {loadingProgress.completed} of {loadingProgress.total}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Scanning BIDS dataset structure...
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <CardTitle className="flex items-center gap-2">
              <Folder className="h-5 w-5 text-purple-600" />
              {datasetDescription?.Name || "BIDS Dataset"}
              <Badge
                variant="secondary"
                className="bg-purple-100 text-purple-700"
              >
                BIDS {datasetDescription?.BIDSVersion || ""}
              </Badge>
              {datasetSummary?.hasFMRI && (
                <Badge
                  variant="secondary"
                  className="bg-blue-100 text-blue-700"
                >
                  fMRI
                </Badge>
              )}
              {datasetSummary?.hasElectrophysiology && (
                <Badge
                  variant="secondary"
                  className="bg-green-100 text-green-700"
                >
                  EEG/MEG
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              {subjects.length} subject{subjects.length !== 1 ? "s" : ""} •{" "}
              {datasetDescription?.DatasetType || "raw"} dataset
              {datasetSummary && datasetSummary.modalities.size > 0 && (
                <span className="ml-1">
                  • Modalities:{" "}
                  {Array.from(datasetSummary.modalities).join(", ")}
                </span>
              )}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        </div>
      </CardHeader>

      <Separator />

      <CardContent className="flex-1 p-4 overflow-hidden">
        {/* Validation Status */}
        {validationResult && !validationResult.valid && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <div className="font-medium mb-1">
                Dataset validation found {validationResult.errors.length} error
                {validationResult.errors.length !== 1 ? "s" : ""}
              </div>
              <ul className="text-xs space-y-1 mt-2">
                {validationResult.errors.slice(0, 3).map((error, idx) => (
                  <li key={idx}>{error.message}</li>
                ))}
                {validationResult.errors.length > 3 && (
                  <li>
                    ... and {validationResult.errors.length - 3} more errors
                  </li>
                )}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {validationResult && validationResult.valid && (
          <Alert className="mb-4 border-green-200 bg-green-50">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-700">
              Valid BIDS dataset
            </AlertDescription>
          </Alert>
        )}

        {/* Dataset Info */}
        {datasetDescription && (
          <div className="mb-4 p-3 bg-muted rounded-lg space-y-2">
            {datasetDescription.Authors &&
              datasetDescription.Authors.length > 0 && (
                <div className="text-sm">
                  <span className="font-medium">Authors:</span>{" "}
                  {datasetDescription.Authors.join(", ")}
                </div>
              )}
            {datasetDescription.License && (
              <div className="text-sm">
                <span className="font-medium">License:</span>{" "}
                {datasetDescription.License}
              </div>
            )}
            {datasetDescription.ReferencesAndLinks &&
              datasetDescription.ReferencesAndLinks.length > 0 && (
                <div className="text-sm">
                  <span className="font-medium">References:</span>{" "}
                  {datasetDescription.ReferencesAndLinks.length} link(s)
                </div>
              )}
          </div>
        )}

        <Separator className="my-3" />

        {/* Subject/Session/Run Browser */}
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-2">
            {subjects.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Folder className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No subjects found in this dataset</p>
              </div>
            ) : (
              subjects.map((subject) => (
                <div key={subject.id} className="border rounded-lg">
                  {/* Subject Header */}
                  <div
                    className="flex items-center gap-3 p-3 cursor-pointer hover:bg-accent transition-colors duration-200"
                    onClick={() => toggleSubject(subject.id)}
                  >
                    <ChevronRight
                      className={`h-4 w-4 transition-transform ${
                        expandedSubjects.has(subject.id) ? "rotate-90" : ""
                      }`}
                    />
                    <User className="h-5 w-5 text-blue-600" />
                    <div className="flex-1">
                      <div className="font-medium">{subject.id}</div>
                      <div className="text-xs text-muted-foreground">
                        {subject.sessions.length} session
                        {subject.sessions.length !== 1 ? "s" : ""}
                      </div>
                    </div>
                  </div>

                  {/* Sessions & Runs */}
                  {expandedSubjects.has(subject.id) && (
                    <div className="border-t bg-muted/30">
                      {subject.sessions.map((session, sessionIdx) => (
                        <div key={sessionIdx} className="p-3 space-y-2">
                          {/* Session Header (if exists) */}
                          {session.id && (
                            <div className="flex items-center gap-2 mb-2">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm font-medium">
                                {session.id}
                              </span>
                            </div>
                          )}

                          {/* Runs */}
                          <div className="space-y-1 ml-6">
                            {session.runs.length === 0 ? (
                              <p className="text-xs text-muted-foreground py-2">
                                No data files found
                              </p>
                            ) : (
                              session.runs.map((run, runIdx) => {
                                const supported = isFileSupported(run.dataFile);
                                return (
                                  <div
                                    key={runIdx}
                                    className={`flex items-center gap-3 p-2 rounded border transition-colors ${
                                      supported
                                        ? "hover:bg-background border-transparent hover:border-border cursor-pointer"
                                        : "opacity-50 border-dashed cursor-not-allowed"
                                    }`}
                                    onClick={() =>
                                      supported && handleRunSelect(run)
                                    }
                                    title={
                                      supported
                                        ? "Click to load this file"
                                        : "File format not yet supported (supported: .edf, .fif, .set, .vhdr, .nii, .nii.gz, .txt, .csv, .ascii)"
                                    }
                                  >
                                    <Activity className="h-4 w-4 text-muted-foreground" />
                                    <div className="flex-1 min-w-0">
                                      <div className="text-sm font-medium truncate">
                                        task-{run.task} run-{run.run}
                                        {!supported && (
                                          <span className="ml-2 text-xs text-orange-600">
                                            (unsupported format)
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-xs text-muted-foreground truncate">
                                        {run.dataFile.split("/").pop()}
                                      </div>
                                    </div>
                                    <Badge
                                      variant="secondary"
                                      className={`text-xs ${getModalityColor(
                                        run.modality,
                                      )}`}
                                    >
                                      {run.modality.toUpperCase()}
                                    </Badge>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
