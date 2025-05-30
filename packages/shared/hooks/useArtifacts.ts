import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "../store";
import { apiRequest } from "../lib/utils/request";
import {
  setArtifacts,
  updateArtifact,
  removeArtifact,
  setLoading,
  setError,
} from "../store/slices/artifactsSlice";
import { useToast } from "../components/ui/use-toast";
import { Artifact } from "../store/slices/artifactsSlice";

export const useArtifacts = () => {
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { artifacts, loading, error } = useAppSelector(
    (state) => state.artifacts
  );

  const fetchArtifacts = useCallback(
    async (token: string) => {
      dispatch(setLoading(true));
      try {
        const response = await apiRequest<Artifact[]>({
          url: "/api/artifacts",
          method: "GET",
          token,
          responseType: "json",
        });
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
        await apiRequest({
          url: "/api/artifacts/share",
          method: "POST",
          token,
          body: { artifact_id: artifactId, share_with_user_ids: userIds },
          responseType: "json",
        });
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
        await apiRequest({
          url: `/api/artifacts/${artifactId}`,
          method: "DELETE",
          token,
          responseType: "json",
        });
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
        const response = await apiRequest<Artifact>({
          url: `/api/artifacts/${artifactId}/rename`,
          method: "PATCH",
          token,
          body: { name: newName },
          responseType: "json",
        });
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

  return {
    artifacts,
    loading,
    error,
    fetchArtifacts,
    shareArtifact,
    deleteArtifact,
    renameArtifact,
  };
};
