"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { tauriBackendService } from "@/services/tauriBackendService";
import type {
  GalleryConfigRequest,
  GalleryItemMetaRequest,
  GalleryItemResponse,
  GalleryExportResponse,
} from "@/services/tauriBackendService";

export const galleryKeys = {
  all: ["gallery"] as const,
  items: () => [...galleryKeys.all, "items"] as const,
};

export function useGalleryItems() {
  return useQuery({
    queryKey: galleryKeys.items(),
    queryFn: () => tauriBackendService.listGalleryItems(),
    staleTime: 30_000,
  });
}

export function useExportGallery() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      analysisIds,
      config,
      itemMetadata,
      outputDirectory,
    }: {
      analysisIds: string[];
      config: GalleryConfigRequest;
      itemMetadata: GalleryItemMetaRequest[];
      outputDirectory: string;
    }) =>
      tauriBackendService.exportGallery(
        analysisIds,
        config,
        itemMetadata,
        outputDirectory,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: galleryKeys.items() });
    },
  });
}

export function useRemoveGalleryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (itemId: string) =>
      tauriBackendService.removeGalleryItem(itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: galleryKeys.items() });
    },
  });
}

export type { GalleryItemResponse, GalleryExportResponse };
