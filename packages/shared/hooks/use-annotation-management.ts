import { useState, useEffect } from "react";
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
  initialAnnotationsFromPlotState,
  onAnnotationsChangeForPlotState,
}: UseAnnotationManagementProps) {
  const [annotations, setAnnotations] = useState<Annotation[]>(
    initialAnnotationsFromPlotState || []
  );
  const { toast } = useToast();

  const {
    data: annotationsData,
    loading: annotationsLoading,
    error: annotationsError,
    refetch: refetchAnnotations,
  } = useQuery(GET_ANNOTATIONS, {
    variables: { filePath },
    skip: !filePath,
    fetchPolicy: "network-only",
    onCompleted: (data) => {
      logger.info("Successfully fetched annotations:", data.getAnnotations);
      const serverAnnotations = data.getAnnotations;
      setAnnotations(serverAnnotations);
      onAnnotationsChangeForPlotState(serverAnnotations);
    },
    onError: (error) => {
      logger.error("Error fetching annotations:", error);
      toast({
        title: "Error Fetching Annotations",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (filePath) {
      logger.info("File path changed to:", filePath, "Refetching annotations.");
      refetchAnnotations();
    }
  }, [filePath, refetchAnnotations]);

  useEffect(() => {
    // This effect synchronizes the hook's internal state if the initial prop changes,
    // for example, when the component using the hook receives new plot state from context.
    // However, it should be careful not to overwrite fresh data from the server.
    // We prioritize server data if available, otherwise use initialAnnotationsFromPlotState.
    if (annotationsData?.getAnnotations) {
      const serverAnnotations = annotationsData.getAnnotations;
      if (JSON.stringify(annotations) !== JSON.stringify(serverAnnotations)) {
        setAnnotations(serverAnnotations);
        // onAnnotationsChangeForPlotState is called in useQuery's onCompleted
      }
    } else if (initialAnnotationsFromPlotState) {
      if (
        JSON.stringify(annotations) !==
        JSON.stringify(initialAnnotationsFromPlotState)
      ) {
        setAnnotations(initialAnnotationsFromPlotState);
      }
    }
  }, [initialAnnotationsFromPlotState, annotationsData, annotations]);

  const [createAnnotationMutation] = useMutation(CREATE_ANNOTATION, {
    onCompleted: (data) => {
      const newAnnotation = data.createAnnotation;
      logger.info("Annotation created:", newAnnotation);
      const updatedAnnotations = [...annotations, newAnnotation];
      setAnnotations(updatedAnnotations);
      onAnnotationsChangeForPlotState(updatedAnnotations);
      toast({
        title: "Annotation added",
        description: "Your annotation has been saved.",
      });
    },
    onError: (error) => {
      logger.error("Error creating annotation:", error);
      toast({
        title: "Error creating annotation",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const [updateAnnotationMutation] = useMutation(UPDATE_ANNOTATION, {
    onCompleted: (data) => {
      const updatedAnnotationData = data.updateAnnotation;
      logger.info("Annotation updated:", updatedAnnotationData);
      const updatedAnnotations = annotations.map((ann) =>
        ann.id === updatedAnnotationData.id ? updatedAnnotationData : ann
      );
      setAnnotations(updatedAnnotations);
      onAnnotationsChangeForPlotState(updatedAnnotations);
      toast({
        title: "Annotation updated",
        description: "Your annotation has been updated.",
      });
    },
    onError: (error) => {
      logger.error("Error updating annotation:", error);
      toast({
        title: "Error updating annotation",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const [deleteAnnotationMutation] = useMutation(DELETE_ANNOTATION, {
    onCompleted: (data, clientOptions) => {
      const deletedId = clientOptions?.variables?.id as number | undefined;
      logger.info("Annotation deleted, ID:", deletedId);
      if (deletedId !== undefined) {
        const updatedAnnotations = annotations.filter(
          (ann) => ann.id !== deletedId
        );
        setAnnotations(updatedAnnotations);
        onAnnotationsChangeForPlotState(updatedAnnotations);
      }
      toast({
        title: "Annotation deleted",
        description: "Your annotation has been removed.",
      });
    },
    onError: (error) => {
      logger.error("Error deleting annotation:", error);
      toast({
        title: "Error deleting annotation",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAddAnnotation = (annotationData: Partial<Annotation>) => {
    if (!filePath) {
      logger.warn("Cannot add annotation, filePath is missing.");
      toast({
        title: "Error",
        description: "File path is missing for annotation.",
        variant: "destructive",
      });
      return;
    }
    createAnnotationMutation({
      variables: {
        annotationInput: {
          filePath: annotationData.filePath || filePath,
          startTime: annotationData.startTime,
          endTime:
            annotationData.endTime !== undefined
              ? annotationData.endTime
              : null,
          text: annotationData.text,
        },
      },
    });
  };

  const handleDeleteAnnotation = (id: number) => {
    deleteAnnotationMutation({
      variables: { id },
    });
  };

  const handleUpdateAnnotation = (
    id: number,
    annotationData: Partial<Annotation>
  ) => {
    if (!filePath && !annotationData.filePath) {
      logger.warn("Cannot update annotation, filePath is missing.");
      toast({
        title: "Error",
        description: "File path is missing for annotation update.",
        variant: "destructive",
      });
      return;
    }
    updateAnnotationMutation({
      variables: {
        id,
        annotationInput: {
          filePath: annotationData.filePath || filePath,
          startTime: annotationData.startTime || 0,
          endTime:
            annotationData.endTime !== undefined
              ? annotationData.endTime
              : null,
          text: annotationData.text || "",
        },
      },
    });
  };

  // This function allows external components like AnnotationEditor to directly set the list,
  // e.g., for local-only changes before a save, or if it manages its own full list.
  // It also ensures the plot state context is updated.
  const setAnnotationsAndPropagate = (newAnnotations: Annotation[]) => {
    setAnnotations(newAnnotations);
    onAnnotationsChangeForPlotState(newAnnotations);
  };

  return {
    annotations,
    setAnnotations: setAnnotationsAndPropagate, // Renamed for clarity
    addAnnotation: handleAddAnnotation,
    updateAnnotation: handleUpdateAnnotation,
    deleteAnnotation: handleDeleteAnnotation,
    loadingAnnotations: annotationsLoading,
    errorAnnotations: annotationsError,
    refetchAnnotations,
  };
}
