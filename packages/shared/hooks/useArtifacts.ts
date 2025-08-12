import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "../store";
import { get, post, _delete, patch } from "../lib/utils/request";
import {
  setArtifacts,
  updateArtifact,
  removeArtifact,
  setLoading,
  setError,
  clearArtifacts,
  setAutoFetch,
} from "../store/slices/artifactsSlice";
import { useToast } from "../components/ui/use-toast";
import { Artifact } from "../store/slices/artifactsSlice";

export const useArtifacts = () => {
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { artifacts, loading, error, autoFetch } = useAppSelector(
    (state) => state.artifacts
  );

  const fetchArtifacts = useCallback(
    async (token: string) => {
      dispatch(setLoading(true));
      try {
        const response = await get<Artifact[]>("/api/artifacts", token);
        dispatch(setArtifacts(response));
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to fetch artifacts";
        dispatch(setError(errorMessage));
        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });
      }
    },
    [dispatch, toast]
  );

  const shareArtifact = useCallback(
    async (token: string, artifactId: string, userIds: number[]) => {
      try {
        await post(
          "/api/artifacts/share",
          { artifact_id: artifactId, share_with_user_ids: userIds },
          token
        );
        toast({
          title: "Success",
          description: "Artifact shared successfully",
        });
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to share artifact";
        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });
        throw err;
      }
    },
    [toast]
  );

  const deleteArtifact = useCallback(
    async (token: string, artifactId: string) => {
      try {
        await _delete(`/api/artifacts/${artifactId}`, token);
        dispatch(removeArtifact(artifactId));
        toast({
          title: "Success",
          description: "Artifact deleted successfully",
        });
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to delete artifact";
        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });
        throw err;
      }
    },
    [dispatch, toast]
  );

  const renameArtifact = useCallback(
    async (token: string, artifactId: string, newName: string) => {
      try {
        const response = await patch<Artifact>(
          `/api/artifacts/${artifactId}/rename`,
          { name: newName },
          token
        );
        dispatch(updateArtifact(response));
        toast({
          title: "Success",
          description: "Artifact renamed successfully",
        });
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to rename artifact";
        toast({
          title: "Error",
          description: errorMessage,
          variant: "destructive",
        });
        throw err;
      }
    },
    [dispatch, toast]
  );

  const clearArtifactsData = useCallback(() => {
    dispatch(clearArtifacts());
    toast({
      title: "Success",
      description: "Artifacts cleared from memory. Auto-loading disabled.",
    });
  }, [dispatch, toast]);

  const enableAutoFetch = useCallback(() => {
    dispatch(setAutoFetch(true));
    toast({
      title: "Success",
      description: "Auto-loading re-enabled",
    });
  }, [dispatch, toast]);

  return {
    artifacts,
    loading,
    error,
    autoFetch,
    fetchArtifacts,
    shareArtifact,
    deleteArtifact,
    renameArtifact,
    clearArtifacts: clearArtifactsData,
    enableAutoFetch,
  };
};
