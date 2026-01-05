/**
 * Hooks for team management
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type {
  Team,
  TeamRole,
  TeamSummary,
  TeamWithMembers,
} from "@/types/sync";

interface CreateTeamRequest {
  name: string;
  description?: string;
  institution_id: string;
}

interface AddMemberRequest {
  team_id: string;
  user_id: string;
  role?: TeamRole;
}

/** Default stale time for team lists (1 minute) */
const TEAMS_STALE_TIME = 60 * 1000;

/** Default stale time for team details (30 seconds) */
const TEAM_DETAILS_STALE_TIME = 30 * 1000;

/**
 * Get teams for current user
 */
export function useMyTeams() {
  return useQuery({
    queryKey: ["teams", "my"],
    queryFn: async () => {
      return invoke<TeamSummary[]>("team_list_my_teams");
    },
    staleTime: TEAMS_STALE_TIME,
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
    // Use empty array as placeholder to render immediately
    // Component shows "no teams" state which updates when real data loads
    placeholderData: [],
  });
}

/**
 * Get teams for an institution
 */
export function useInstitutionTeams(institutionId: string) {
  return useQuery({
    queryKey: ["teams", "institution", institutionId],
    queryFn: async () => {
      return invoke<TeamSummary[]>("team_list_institution_teams", {
        institutionId,
      });
    },
    enabled: !!institutionId,
    staleTime: TEAMS_STALE_TIME,
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });
}

/**
 * Get team details with members
 */
export function useTeam(teamId: string) {
  return useQuery({
    queryKey: ["teams", teamId],
    queryFn: async () => {
      return invoke<TeamWithMembers>("team_get", { teamId });
    },
    enabled: !!teamId,
    staleTime: TEAM_DETAILS_STALE_TIME,
    retry: 2,
  });
}

/**
 * Create a new team
 */
export function useCreateTeam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: CreateTeamRequest) => {
      return invoke<Team>("team_create", { request });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
    },
  });
}

/**
 * Update a team
 */
export function useUpdateTeam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      teamId,
      name,
      description,
    }: {
      teamId: string;
      name: string;
      description?: string;
    }) => {
      await invoke("team_update", { teamId, name, description });
    },
    onSuccess: (_, { teamId }) => {
      queryClient.invalidateQueries({ queryKey: ["teams", teamId] });
      queryClient.invalidateQueries({ queryKey: ["teams"] });
    },
  });
}

/**
 * Delete a team
 */
export function useDeleteTeam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (teamId: string) => {
      await invoke("team_delete", { teamId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
    },
  });
}

/**
 * Add member to team
 */
export function useAddTeamMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: AddMemberRequest) => {
      await invoke("team_add_member", { request });
    },
    onSuccess: (_, { team_id }) => {
      queryClient.invalidateQueries({ queryKey: ["teams", team_id] });
    },
  });
}

/**
 * Remove member from team
 */
export function useRemoveTeamMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      teamId,
      userId,
    }: {
      teamId: string;
      userId: string;
    }) => {
      await invoke("team_remove_member", { teamId, userId });
    },
    onSuccess: (_, { teamId }) => {
      queryClient.invalidateQueries({ queryKey: ["teams", teamId] });
    },
  });
}

/**
 * Update member role
 */
export function useUpdateMemberRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      teamId,
      userId,
      role,
    }: {
      teamId: string;
      userId: string;
      role: TeamRole;
    }) => {
      await invoke("team_update_member_role", { teamId, userId, role });
    },
    onSuccess: (_, { teamId }) => {
      queryClient.invalidateQueries({ queryKey: ["teams", teamId] });
    },
  });
}
