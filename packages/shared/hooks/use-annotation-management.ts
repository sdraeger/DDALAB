import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@apollo/client";
import {
  GET_ANNOTATIONS,
  CREATE_ANNOTATION,
  UPDATE_ANNOTATION,
  DELETE_ANNOTATION,
} from "../lib/graphql/queries";
import { Annotation, UseAnnotationManagementProps } from "../types/annotation";
import { useToast } from "../components/ui/use-toast";
import logger from "../lib/utils/logger";

export function useAnnotationManagement({
  filePath,
  initialAnnotationsFromPlotState = [],
  onAnnotationsChangeForPlotState,
}: UseAnnotationManagementProps) {
  const [annotations, setAnnotations] = useState<Annotation[]>(
    initialAnnotationsFromPlotState
  );
  const { toast } = useToast();

  const showErrorToast = useCallback(
    (title: string, error: Error) => {
      logger.error(`${title}:`, error);
      toast({ title, description: error.message, variant: "destructive" });
    },
    [toast]
  );

  const { data, loading, error, refetch } = useQuery(GET_ANNOTATIONS, {
    variables: { filePath },
    skip: !filePath,
    fetchPolicy: "network-only",
    onCompleted: ({ getAnnotations }) => {
      logger.info("Fetched annotations:", getAnnotations);
      setAnnotations(getAnnotations);
      onAnnotationsChangeForPlotState(getAnnotations);
    },
    onError: (err) => showErrorToast("Error Fetching Annotations", err),
  });

  useEffect(() => {
    if (filePath) {
      logger.info("Refetching annotations for filePath:", filePath);
      refetch();
    }
  }, [filePath, refetch]);

  useEffect(() => {
    if (data?.getAnnotations) {
      setAnnotations(data.getAnnotations);
    } else if (initialAnnotationsFromPlotState) {
      setAnnotations(initialAnnotationsFromPlotState);
    }
  }, [data, initialAnnotationsFromPlotState]);

  const [createAnnotation] = useMutation(CREATE_ANNOTATION, {
    onCompleted: ({ createAnnotation: newAnnotation }) => {
      logger.info("Annotation created:", newAnnotation);
      const updatedAnnotations = [...annotations, newAnnotation];
      setAnnotations(updatedAnnotations);
      onAnnotationsChangeForPlotState(updatedAnnotations);
      toast({
        title: "Annotation added",
        description: "Your annotation has been saved.",
      });
    },
    onError: (err) => showErrorToast("Error creating annotation", err),
  });

  const [updateAnnotation] = useMutation(UPDATE_ANNOTATION, {
    onCompleted: ({ updateAnnotation: updatedAnnotation }) => {
      logger.info("Annotation updated:", updatedAnnotation);
      const updatedAnnotations = annotations.map((ann) =>
        ann.id === updatedAnnotation.id ? updatedAnnotation : ann
      );
      setAnnotations(updatedAnnotations);
      onAnnotationsChangeForPlotState(updatedAnnotations);
      toast({
        title: "Annotation updated",
        description: "Your annotation has been updated.",
      });
    },
    onError: (err) => showErrorToast("Error updating annotation", err),
  });

  const [deleteAnnotation] = useMutation(DELETE_ANNOTATION, {
    onCompleted: (_, clientOptions) => {
      const id = clientOptions?.variables?.id as number | undefined;
      if (id === undefined) {
        logger.error("No ID provided for deleted annotation");
        return;
      }
      logger.info("Annotation deleted, ID:", id);
      const updatedAnnotations = annotations.filter((ann) => ann.id !== id);
      setAnnotations(updatedAnnotations);
      onAnnotationsChangeForPlotState(updatedAnnotations);
      toast({
        title: "Annotation deleted",
        description: "Your annotation has been removed.",
      });
    },
    onError: (err) => showErrorToast("Error deleting annotation", err),
  });

  const handleAddAnnotation = useCallback(
    (annotationData: Partial<Annotation>) => {
      if (!filePath) {
        showErrorToast(
          "Error",
          new Error("File path is missing for annotation.")
        );
        return;
      }
      createAnnotation({
        variables: {
          annotationInput: {
            filePath: annotationData.filePath || filePath,
            startTime: annotationData.startTime,
            endTime: annotationData.endTime ?? null,
            text: annotationData.text,
          },
        },
      });
    },
    [filePath, createAnnotation, showErrorToast]
  );

  const handleUpdateAnnotation = useCallback(
    (id: number, annotationData: Partial<Annotation>) => {
      if (!filePath && !annotationData.filePath) {
        showErrorToast(
          "Error",
          new Error("File path is missing for annotation update.")
        );
        return;
      }
      updateAnnotation({
        variables: {
          id,
          annotationInput: {
            filePath: annotationData.filePath || filePath,
            startTime: annotationData.startTime ?? 0,
            endTime: annotationData.endTime ?? null,
            text: annotationData.text ?? "",
          },
        },
      });
    },
    [filePath, updateAnnotation, showErrorToast]
  );

  const handleDeleteAnnotation = useCallback(
    (id: number) => {
      deleteAnnotation({ variables: { id } });
    },
    [deleteAnnotation]
  );

  const setAnnotationsAndPropagate = useCallback(
    (newAnnotations: Annotation[]) => {
      setAnnotations(newAnnotations);
      onAnnotationsChangeForPlotState(newAnnotations);
    },
    [onAnnotationsChangeForPlotState]
  );

  return {
    annotations,
    setAnnotations: setAnnotationsAndPropagate,
    addAnnotation: handleAddAnnotation,
    updateAnnotation: handleUpdateAnnotation,
    deleteAnnotation: handleDeleteAnnotation,
    loadingAnnotations: loading,
    errorAnnotations: error,
    refetchAnnotations: refetch,
  };
}
