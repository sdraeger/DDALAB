import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/store/appStore";
import type {
  WorkflowNode,
  WorkflowEdge,
  WorkflowAction,
  WorkflowInfo,
  NodeInfo,
} from "@/types/workflow";

// ============================================================================
// Types
// ============================================================================

export interface BufferInfo {
  current_size: number;
  total_recorded: number;
  auto_recording_enabled: boolean;
}

// ============================================================================
// Query Keys Factory
// ============================================================================

export const workflowKeys = {
  all: ["workflow"] as const,
  info: () => [...workflowKeys.all, "info"] as const,
  buffer: () => [...workflowKeys.all, "buffer"] as const,
  bufferInfo: () => [...workflowKeys.buffer(), "info"] as const,
  autoRecording: () => [...workflowKeys.all, "autoRecording"] as const,
  nodes: () => [...workflowKeys.all, "nodes"] as const,
  nodesList: () => [...workflowKeys.nodes(), "list"] as const,
  node: (nodeId: string) => [...workflowKeys.nodes(), nodeId] as const,
  edges: () => [...workflowKeys.all, "edges"] as const,
  edgesList: () => [...workflowKeys.edges(), "list"] as const,
  topologicalOrder: () => [...workflowKeys.all, "topologicalOrder"] as const,
};

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * Query hook for buffer info with automatic polling
 */
export function useBufferInfo(options?: {
  enabled?: boolean;
  refetchInterval?: number;
}) {
  return useQuery({
    queryKey: workflowKeys.bufferInfo(),
    queryFn: async (): Promise<BufferInfo> => {
      return await invoke<BufferInfo>("workflow_get_buffer_info");
    },
    staleTime: 1000, // 1 second
    gcTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: options?.refetchInterval ?? 2000, // Poll every 2 seconds by default
    enabled: options?.enabled ?? true,
    retry: 1,
  });
}

/**
 * Query hook for auto-recording status
 */
export function useAutoRecordingStatus(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: workflowKeys.autoRecording(),
    queryFn: async (): Promise<boolean> => {
      return await invoke<boolean>("workflow_is_auto_recording");
    },
    staleTime: 5000, // 5 seconds
    gcTime: 5 * 60 * 1000,
    enabled: options?.enabled ?? true,
    retry: 1,
  });
}

/**
 * Query hook for workflow info
 */
export function useWorkflowInfo(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: workflowKeys.info(),
    queryFn: async (): Promise<WorkflowInfo> => {
      return await invoke<WorkflowInfo>("workflow_get_info");
    },
    staleTime: 10000, // 10 seconds
    gcTime: 5 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

/**
 * Query hook for all nodes
 */
export function useWorkflowNodes(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: workflowKeys.nodesList(),
    queryFn: async (): Promise<WorkflowNode[]> => {
      return await invoke<WorkflowNode[]>("workflow_get_all_nodes");
    },
    staleTime: 10000,
    gcTime: 5 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

/**
 * Query hook for a specific node
 */
export function useWorkflowNode(
  nodeId: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: workflowKeys.node(nodeId),
    queryFn: async (): Promise<NodeInfo | null> => {
      return await invoke<NodeInfo | null>("workflow_get_node", { nodeId });
    },
    staleTime: 30000, // 30 seconds
    gcTime: 5 * 60 * 1000,
    enabled: options?.enabled ?? !!nodeId,
  });
}

/**
 * Query hook for all edges
 */
export function useWorkflowEdges(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: workflowKeys.edgesList(),
    queryFn: async (): Promise<WorkflowEdge[]> => {
      return await invoke<WorkflowEdge[]>("workflow_get_all_edges");
    },
    staleTime: 10000,
    gcTime: 5 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

/**
 * Query hook for topological order
 */
export function useTopologicalOrder(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: workflowKeys.topologicalOrder(),
    queryFn: async (): Promise<string[]> => {
      return await invoke<string[]>("workflow_get_topological_order");
    },
    staleTime: 10000,
    gcTime: 5 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Mutation hook for enabling auto-recording
 * Also syncs with Zustand store so components checking isRecording work correctly
 */
export function useEnableAutoRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      console.log("[WORKFLOW-QUERY] Calling workflow_enable_auto_record...");
      await invoke("workflow_enable_auto_record");
      console.log("[WORKFLOW-QUERY] workflow_enable_auto_record completed");
    },
    onSuccess: () => {
      // Sync with Zustand store so components checking workflowRecording.isRecording work
      console.log(
        "[WORKFLOW-QUERY] Syncing Zustand store - starting recording",
      );
      useAppStore.getState().startWorkflowRecording("auto_record_session");
      console.log(
        "[WORKFLOW-QUERY] Zustand store updated, isRecording:",
        useAppStore.getState().workflowRecording.isRecording,
      );

      queryClient.invalidateQueries({ queryKey: workflowKeys.autoRecording() });
      queryClient.invalidateQueries({ queryKey: workflowKeys.bufferInfo() });
    },
  });
}

/**
 * Mutation hook for disabling auto-recording
 * Also syncs with Zustand store
 */
export function useDisableAutoRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      console.log("[WORKFLOW-QUERY] Calling workflow_disable_auto_record...");
      await invoke("workflow_disable_auto_record");
      console.log("[WORKFLOW-QUERY] workflow_disable_auto_record completed");
    },
    onSuccess: () => {
      // Sync with Zustand store
      console.log(
        "[WORKFLOW-QUERY] Syncing Zustand store - stopping recording",
      );
      useAppStore.getState().stopWorkflowRecording();

      queryClient.invalidateQueries({ queryKey: workflowKeys.autoRecording() });
      queryClient.invalidateQueries({ queryKey: workflowKeys.bufferInfo() });
    },
  });
}

/**
 * Mutation hook for clearing buffer
 */
export function useClearBuffer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await invoke("workflow_clear_buffer");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.buffer() });
    },
  });
}

/**
 * Mutation hook for adding a node
 */
export function useAddNode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (node: WorkflowNode): Promise<string> => {
      return await invoke<string>("workflow_add_node", { node });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.nodes() });
      queryClient.invalidateQueries({ queryKey: workflowKeys.info() });
      queryClient.invalidateQueries({
        queryKey: workflowKeys.topologicalOrder(),
      });
    },
  });
}

/**
 * Mutation hook for removing a node
 */
export function useRemoveNode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (nodeId: string) => {
      await invoke("workflow_remove_node", { nodeId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.nodes() });
      queryClient.invalidateQueries({ queryKey: workflowKeys.edges() });
      queryClient.invalidateQueries({ queryKey: workflowKeys.info() });
      queryClient.invalidateQueries({
        queryKey: workflowKeys.topologicalOrder(),
      });
    },
  });
}

/**
 * Mutation hook for adding an edge
 */
export function useAddEdge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (edge: WorkflowEdge) => {
      await invoke("workflow_add_edge", { edge });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.edges() });
      queryClient.invalidateQueries({ queryKey: workflowKeys.info() });
      queryClient.invalidateQueries({
        queryKey: workflowKeys.topologicalOrder(),
      });
    },
  });
}

/**
 * Mutation hook for creating a new workflow
 */
export function useNewWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (name: string) => {
      await invoke("workflow_new", { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.all });
    },
  });
}

/**
 * Mutation hook for clearing workflow
 */
export function useClearWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await invoke("workflow_clear");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.all });
    },
  });
}

/**
 * Mutation hook for recording an action
 */
export function useRecordAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (action: WorkflowAction): Promise<string> => {
      return await invoke<string>("workflow_record_action", { action });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.nodes() });
      queryClient.invalidateQueries({ queryKey: workflowKeys.info() });
    },
  });
}

/**
 * Mutation hook for auto-recording an action (silent, no invalidation needed)
 */
export function useAutoRecordAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      action,
      activeFileId,
    }: {
      action: WorkflowAction;
      activeFileId?: string;
    }) => {
      console.log("[WORKFLOW-QUERY] Auto-recording action:", action.type, {
        activeFileId,
      });
      await invoke("workflow_auto_record", {
        action,
        activeFileId: activeFileId || null,
      });
      console.log("[WORKFLOW-QUERY] Auto-record action completed");
    },
    onSuccess: () => {
      console.log(
        "[WORKFLOW-QUERY] Auto-record success, invalidating buffer info",
      );
      // Only invalidate buffer info, not the whole workflow
      queryClient.invalidateQueries({ queryKey: workflowKeys.bufferInfo() });
    },
    onError: (error) => {
      console.error("[WORKFLOW-QUERY] Auto-record action failed:", error);
    },
  });
}

/**
 * Mutation hook for generating code from buffer
 */
export function useGenerateCodeFromBuffer() {
  return useMutation({
    mutationFn: async ({
      language,
      workflowName,
      lastNMinutes,
      optimize,
    }: {
      language: "python" | "julia" | "matlab" | "rust" | "r";
      workflowName: string;
      lastNMinutes?: number;
      optimize?: boolean;
    }): Promise<string> => {
      return await invoke<string>("workflow_generate_code_from_buffer", {
        language,
        workflowName,
        lastNMinutes: lastNMinutes || null,
        optimize: optimize ?? true,
      });
    },
  });
}

/**
 * Mutation hook for exporting workflow from buffer
 */
export function useExportFromBuffer() {
  return useMutation({
    mutationFn: async ({
      workflowName,
      lastNMinutes,
    }: {
      workflowName: string;
      lastNMinutes?: number;
    }): Promise<string> => {
      return await invoke<string>("workflow_export_from_buffer", {
        workflowName,
        lastNMinutes: lastNMinutes || null,
      });
    },
  });
}

/**
 * Mutation hook for exporting workflow to JSON
 */
export function useExportWorkflow() {
  return useMutation({
    mutationFn: async (): Promise<string> => {
      return await invoke<string>("workflow_export");
    },
  });
}

/**
 * Mutation hook for importing workflow from JSON
 */
export function useImportWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (json: string) => {
      await invoke("workflow_import", { json });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.all });
    },
  });
}

/**
 * Mutation hook for validating workflow
 */
export function useValidateWorkflow() {
  return useMutation({
    mutationFn: async (): Promise<boolean> => {
      try {
        await invoke("workflow_validate");
        return true;
      } catch {
        return false;
      }
    },
  });
}

/**
 * Mutation hook for generating Python code
 */
export function useGeneratePython() {
  return useMutation({
    mutationFn: async (): Promise<string> => {
      return await invoke<string>("workflow_generate_python");
    },
  });
}

/**
 * Mutation hook for generating Julia code
 */
export function useGenerateJulia() {
  return useMutation({
    mutationFn: async (): Promise<string> => {
      return await invoke<string>("workflow_generate_julia");
    },
  });
}

// ============================================================================
// Cache Invalidation Helper
// ============================================================================

/**
 * Helper hook for manual cache invalidation
 */
export function useInvalidateWorkflow() {
  const queryClient = useQueryClient();

  return {
    invalidateAll: () =>
      queryClient.invalidateQueries({ queryKey: workflowKeys.all }),
    invalidateBuffer: () =>
      queryClient.invalidateQueries({ queryKey: workflowKeys.buffer() }),
    invalidateNodes: () =>
      queryClient.invalidateQueries({ queryKey: workflowKeys.nodes() }),
    invalidateEdges: () =>
      queryClient.invalidateQueries({ queryKey: workflowKeys.edges() }),
    invalidateInfo: () =>
      queryClient.invalidateQueries({ queryKey: workflowKeys.info() }),
    refetchBufferInfo: () =>
      queryClient.refetchQueries({ queryKey: workflowKeys.bufferInfo() }),
  };
}
