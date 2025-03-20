"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@apollo/client";
import {
  GET_ANNOTATIONS,
  CREATE_ANNOTATION,
  UPDATE_ANNOTATION,
  DELETE_ANNOTATION,
} from "@/lib/graphql/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Plus, Edit, Trash, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { gql } from "@apollo/client";
import { isAuthenticated } from "@/lib/auth";

export type Annotation = {
  id: number;
  userId: number;
  filePath: string;
  startTime: number;
  endTime?: number | null;
  text: string;
  createdAt: string;
  updatedAt: string;
};

export type AnnotationInput = {
  filePath: string;
  startTime: number;
  endTime?: number | null;
  text: string;
};

interface AnnotationEditorProps {
  filePath?: string;
  eegData?: any;
  currentSample: number;
  sampleRate?: number;
  onAnnotationSelect?: (annotation: Annotation) => void;
  initialAnnotations?: Annotation[];
  onAnnotationsChange?: (annotations: Annotation[]) => void;
  onAnnotationUpdate?: (id: number, annotation: Partial<Annotation>) => void;
}

export function AnnotationEditor({
  filePath,
  eegData,
  currentSample,
  sampleRate,
  onAnnotationSelect,
  initialAnnotations,
  onAnnotationsChange,
  onAnnotationUpdate,
}: AnnotationEditorProps) {
  const effectiveFilePath = filePath || eegData?.filePath;
  const effectiveSampleRate = sampleRate || eegData?.sampleRate || 256;

  // Use initialAnnotations if provided (for cached annotations)
  const [localAnnotations, setLocalAnnotations] = useState<Annotation[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Use initial annotations or query for them
  const { loading, error, data, refetch } = useQuery(GET_ANNOTATIONS, {
    variables: {
      filePath: effectiveFilePath,
    },
    skip: !effectiveFilePath || initialAnnotations !== undefined,
    fetchPolicy: "network-only",
  });

  // Use initialAnnotations if provided, otherwise use data from query
  const annotations = initialAnnotations || data?.getAnnotations || [];

  // Notify parent when annotations change
  const updateAnnotations = (newAnnotations: Annotation[]) => {
    if (onAnnotationsChange) {
      onAnnotationsChange(newAnnotations);
    }
  };

  // Mutations for annotation management
  const [createAnnotation] = useMutation(CREATE_ANNOTATION, {
    onCompleted: (data) => {
      const newAnnotation = data.createAnnotation;
      const newAnnotations = [...annotations, newAnnotation];
      updateAnnotations(newAnnotations);
      toast({
        title: "Success",
        description: "Annotation created successfully.",
      });
      setDialogOpen(false);
      setAnnotationText("");
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const [updateAnnotation] = useMutation(UPDATE_ANNOTATION, {
    onCompleted: (data) => {
      const updatedAnnotation = data.updateAnnotation;
      const newAnnotations = annotations.map((ann: Annotation) =>
        ann.id === updatedAnnotation.id ? updatedAnnotation : ann
      );
      updateAnnotations(newAnnotations);
      toast({
        title: "Success",
        description: "Annotation updated successfully.",
      });
      setDialogOpen(false);
      setEditingAnnotation(null);
      setAnnotationText("");
      // Refetch to make sure the cache is up to date
      if (effectiveFilePath) {
        refetch({ filePath: effectiveFilePath });
      }
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const [deleteAnnotation] = useMutation(DELETE_ANNOTATION, {
    onCompleted: () => {
      // Remove from local state
      if (editingAnnotation) {
        const newAnnotations = annotations.filter(
          (ann: Annotation) => ann.id !== editingAnnotation.id
        );
        updateAnnotations(newAnnotations);
      }
      toast({
        title: "Success",
        description: "Annotation deleted successfully.",
      });
      // Refetch to make sure the cache is up to date
      if (effectiveFilePath) {
        refetch({ filePath: effectiveFilePath });
      }
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
    update: (cache, { data }) => {
      if (data?.deleteAnnotation && editingAnnotation) {
        // Update Apollo cache
        const newAnnotations = annotations.filter(
          (ann: Annotation) => ann.id !== editingAnnotation.id
        );
        updateAnnotations(newAnnotations);
      }
    },
  });

  const [editingAnnotation, setEditingAnnotation] = useState<Annotation | null>(
    null
  );
  const [annotationText, setAnnotationText] = useState("");

  const handleAddAnnotation = () => {
    setEditingAnnotation(null);
    setAnnotationText("");
    setDialogOpen(true);
  };

  const handleEditAnnotation = (annotation: Annotation) => {
    setEditingAnnotation(annotation);
    setAnnotationText(annotation.text);
    setDialogOpen(true);
  };

  const handleSaveAnnotation = () => {
    if (!annotationText.trim()) {
      toast({
        title: "Error",
        description: "Annotation text cannot be empty.",
        variant: "destructive",
      });
      return;
    }

    const input: AnnotationInput = {
      filePath: effectiveFilePath || "",
      startTime: editingAnnotation
        ? editingAnnotation.startTime
        : currentSample,
      endTime: null, // Optional end time
      text: annotationText.trim(),
    };

    if (editingAnnotation) {
      if (onAnnotationUpdate) {
        // Use the direct update function if provided
        onAnnotationUpdate(editingAnnotation.id, input);
        setDialogOpen(false);
        setEditingAnnotation(null);
        setAnnotationText("");
      } else {
        // Fall back to the GraphQL mutation
        updateAnnotation({
          variables: {
            id: editingAnnotation.id,
            annotationInput: input,
          },
        });
      }
    } else {
      createAnnotation({
        variables: {
          annotationInput: input,
        },
      });
    }
  };

  const handleDeleteAnnotation = (id: number) => {
    if (confirm("Are you sure you want to delete this annotation?")) {
      deleteAnnotation({
        variables: { id },
        context: {
          fetchOptions: {
            credentials: "include", // Ensure cookies are sent
          },
        },
      });
    }
  };

  const handleSelectAnnotation = (annotation: Annotation) => {
    if (onAnnotationSelect) {
      onAnnotationSelect(annotation);
    }
  };

  // Convert sample position to time
  const formatTime = (sample: number) => {
    const seconds = sample / effectiveSampleRate;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Annotations</h3>
        <Button
          size="sm"
          onClick={handleAddAnnotation}
          disabled={!effectiveFilePath}
        >
          <Plus className="w-4 h-4 mr-1" /> Add Annotation
        </Button>
      </div>

      {loading && (
        <div className="flex justify-center p-4">
          <Spinner />
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            Error loading annotations: {error.message}
          </AlertDescription>
        </Alert>
      )}

      {!loading && annotations.length === 0 && (
        <div className="text-center py-4 text-muted-foreground">
          No annotations for this file yet.
        </div>
      )}

      {annotations.length > 0 && (
        <div className="space-y-2">
          {annotations.map((annotation: Annotation) => (
            <div
              key={annotation.id}
              className="flex items-start justify-between bg-card p-3 rounded-md border cursor-pointer"
              onClick={() => handleSelectAnnotation(annotation)}
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                    {formatTime(annotation.startTime)}
                  </span>
                  <span className="text-sm font-medium truncate">
                    {annotation.text}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={(e) => {
                    e.stopPropagation(); // Prevent triggering parent onClick
                    handleEditAnnotation(annotation);
                  }}
                >
                  <Edit className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive"
                  onClick={(e) => {
                    e.stopPropagation(); // Prevent triggering parent onClick
                    handleDeleteAnnotation(annotation.id);
                  }}
                >
                  <Trash className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingAnnotation ? "Edit Annotation" : "Add Annotation"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <div className="flex items-center mb-2">
                <span className="text-sm font-medium">Time Position:</span>
                <span className="ml-2 text-sm">
                  {formatTime(
                    editingAnnotation
                      ? editingAnnotation.startTime
                      : currentSample
                  )}
                </span>
              </div>

              <Textarea
                placeholder="Enter your annotation here..."
                value={annotationText}
                onChange={(e) => setAnnotationText(e.target.value)}
                className="h-32"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveAnnotation}>
              {editingAnnotation ? "Update" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
