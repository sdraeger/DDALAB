/**
 * Hook for sharing any content type through the collaboration system
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type {
  ShareableContentType,
  AccessPolicyType,
  DataClassification,
} from "@/types/sync";

interface ShareContentRequest {
  contentType: ShareableContentType;
  contentId: string;
  title: string;
  description?: string;
  accessPolicy: {
    type: AccessPolicyType;
    team_id?: string;
    user_ids?: string[];
    institution_id: string;
    federated_institution_ids?: string[];
    permissions: ("view" | "download" | "reshare")[];
    expires_at: string;
    max_downloads?: number;
  };
  classification: DataClassification;
  contentData?: unknown;
}

/**
 * Share any content type
 */
export function useShareContent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: ShareContentRequest): Promise<string> => {
      const shareLink = await invoke<string>("sync_share_content", {
        request: {
          content_type: request.contentType,
          content_id: request.contentId,
          title: request.title,
          description: request.description ?? null,
          access_policy: request.accessPolicy,
          classification: request.classification,
          content_data: request.contentData ?? null,
        },
      });
      return shareLink;
    },
    onSuccess: () => {
      // Invalidate share lists
      queryClient.invalidateQueries({ queryKey: ["shares"] });
    },
  });
}

/**
 * Helper to create a default access policy
 */
export function createDefaultAccessPolicy(
  institutionId: string,
  classification: DataClassification = "unclassified",
): ShareContentRequest["accessPolicy"] {
  const expiryDays =
    classification === "phi"
      ? 7
      : classification === "de_identified"
        ? 30
        : classification === "synthetic"
          ? 90
          : 30;

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiryDays);

  return {
    type: "public",
    institution_id: institutionId,
    permissions: ["view", "download"],
    expires_at: expiresAt.toISOString(),
  };
}

export type { ShareContentRequest };
