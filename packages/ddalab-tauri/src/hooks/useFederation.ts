/**
 * Hooks for federation management
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type {
  FederatedInstitutionSummary,
  FederationInvite,
  FederationTrust,
  InviteResponse,
  TrustLevel,
} from "@/types/sync";

interface CreateInviteParams {
  institutionId: string;
  toInstitutionName?: string;
  expiryDays?: number;
}

interface AcceptInviteParams {
  inviteToken: string;
  institutionId: string;
}

/**
 * Get federated institutions for current institution
 */
export function useFederatedInstitutions(institutionId: string) {
  return useQuery({
    queryKey: ["federation", "institutions", institutionId],
    queryFn: async () => {
      return invoke<FederatedInstitutionSummary[]>(
        "federation_list_federated_institutions",
        { institutionId },
      );
    },
    enabled: !!institutionId,
  });
}

/**
 * Get pending invites from current institution
 */
export function usePendingInvites(institutionId: string) {
  return useQuery({
    queryKey: ["federation", "invites", institutionId],
    queryFn: async () => {
      return invoke<FederationInvite[]>("federation_list_pending_invites", {
        institutionId,
      });
    },
    enabled: !!institutionId,
  });
}

/**
 * Get invite by token (for accepting)
 */
export function useInviteByToken(token: string) {
  return useQuery({
    queryKey: ["federation", "invite", token],
    queryFn: async () => {
      return invoke<FederationInvite>("federation_get_invite", { token });
    },
    enabled: !!token,
  });
}

/**
 * Create a federation invite
 */
export function useCreateInvite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      institutionId,
      toInstitutionName,
      expiryDays,
    }: CreateInviteParams) => {
      return invoke<InviteResponse>("federation_create_invite", {
        institutionId,
        toInstitutionName,
        expiryDays: expiryDays ?? 7,
      });
    },
    onSuccess: (_, { institutionId }) => {
      queryClient.invalidateQueries({
        queryKey: ["federation", "invites", institutionId],
      });
    },
  });
}

/**
 * Accept a federation invite
 */
export function useAcceptInvite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ inviteToken, institutionId }: AcceptInviteParams) => {
      return invoke<FederationTrust>("federation_accept_invite", {
        inviteToken,
        institutionId,
      });
    },
    onSuccess: (_, { institutionId }) => {
      queryClient.invalidateQueries({
        queryKey: ["federation", "institutions", institutionId],
      });
      queryClient.invalidateQueries({ queryKey: ["federation", "invite"] });
    },
  });
}

/**
 * Revoke a federation invite
 */
export function useRevokeInvite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (inviteId: string) => {
      await invoke("federation_revoke_invite", { inviteId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["federation", "invites"] });
    },
  });
}

/**
 * Update trust level
 */
export function useUpdateTrustLevel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      trustId,
      trustLevel,
    }: {
      trustId: string;
      trustLevel: TrustLevel;
    }) => {
      await invoke("federation_update_trust_level", { trustId, trustLevel });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["federation", "institutions"],
      });
    },
  });
}

/**
 * Revoke trust relationship
 */
export function useRevokeTrust() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (trustId: string) => {
      await invoke("federation_revoke_trust", { trustId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["federation", "institutions"],
      });
    },
  });
}

/**
 * Check if two institutions are federated
 */
export function useCheckFederation(institutionA: string, institutionB: string) {
  return useQuery({
    queryKey: ["federation", "check", institutionA, institutionB],
    queryFn: async () => {
      return invoke<FederationTrust | null>("federation_check", {
        institutionA,
        institutionB,
      });
    },
    enabled: !!institutionA && !!institutionB,
  });
}
