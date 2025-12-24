import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/store/appStore";
import type {
  WorkflowNode,
  WorkflowEdge,
  WorkflowAction,
  WorkflowInfo,
  NodeInfo,
} from "@/types/workflow";

/**
 * @deprecated This hook uses manual state management. Prefer useWorkflowQueries.ts
 * which provides React Query hooks with automatic caching, polling, and cache invalidation.
 *
 * Migration guide:
 * - useBufferInfo() - replaces getBufferInfo with automatic polling
 * - useAutoRecordingStatus() - replaces isAutoRecording
 * - useWorkflowInfo() - replaces getWorkflowInfo
 * - useWorkflowNodes() - replaces getAllNodes
 * - useWorkflowEdges() - replaces getAllEdges
 * - useRecordAction() - mutation for recordAction
 * - useAutoRecordAction() - mutation for autoRecordAction
 * - useEnableAutoRecord() / useDisableAutoRecord() - mutations
 * - useClearBuffer() / useClearWorkflow() - mutations
 * - useGeneratePython() / useGenerateJulia() - mutations
 * - useGenerateCodeFromBuffer() - mutation with language parameter
 * - useExportWorkflow() / useExportFromBuffer() - mutations
 * - useNewWorkflow() - mutation for newWorkflow
 *
 * @see src/hooks/useWorkflowQueries.ts
 */
export function useWorkflow() {
  const { workflowRecording } = useAppStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workflowInfo, setWorkflowInfo] = useState<WorkflowInfo | null>(null);

  /**
   * Create a new workflow with the given name
   */
  const newWorkflow = useCallback(async (name: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await invoke("workflow_new", { name });
      await refreshWorkflowInfo();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create new workflow";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Clear the current workflow
   */
  const clearWorkflow = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await invoke("workflow_clear");
      await refreshWorkflowInfo();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to clear workflow";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Add a node to the workflow
   */
  const addNode = useCallback(async (node: WorkflowNode): Promise<string> => {
    setIsLoading(true);
    setError(null);
    try {
      const nodeId = await invoke<string>("workflow_add_node", { node });
      await refreshWorkflowInfo();
      return nodeId;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to add node";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Remove a node from the workflow
   */
  const removeNode = useCallback(async (nodeId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await invoke("workflow_remove_node", { nodeId });
      await refreshWorkflowInfo();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to remove node";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Get detailed information about a specific node
   */
  const getNode = useCallback(
    async (nodeId: string): Promise<NodeInfo | null> => {
      setIsLoading(true);
      setError(null);
      try {
        const nodeInfo = await invoke<NodeInfo | null>("workflow_get_node", {
          nodeId,
        });
        return nodeInfo;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to get node";
        setError(message);
        throw new Error(message);
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  /**
   * Add an edge (dependency) between two nodes
   */
  const addEdge = useCallback(async (edge: WorkflowEdge) => {
    setIsLoading(true);
    setError(null);
    try {
      await invoke("workflow_add_edge", { edge });
      await refreshWorkflowInfo();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to add edge";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Get all nodes in the workflow
   */
  const getAllNodes = useCallback(async (): Promise<WorkflowNode[]> => {
    setIsLoading(true);
    setError(null);
    try {
      const nodes = await invoke<WorkflowNode[]>("workflow_get_all_nodes");
      return nodes;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to get nodes";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Get all edges in the workflow
   */
  const getAllEdges = useCallback(async (): Promise<WorkflowEdge[]> => {
    setIsLoading(true);
    setError(null);
    try {
      const edges = await invoke<WorkflowEdge[]>("workflow_get_all_edges");
      return edges;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to get edges";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Get the topological order of nodes (execution order)
   */
  const getTopologicalOrder = useCallback(async (): Promise<string[]> => {
    setIsLoading(true);
    setError(null);
    try {
      const order = await invoke<string[]>("workflow_get_topological_order");
      return order;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to get topological order";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Validate the workflow (check for cycles, etc.)
   */
  const validateWorkflow = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    try {
      await invoke("workflow_validate");
      return true;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Workflow validation failed";
      setError(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Record an action to the workflow
   * This is the main method called when user performs actions in the UI
   */
  const recordAction = useCallback(
    async (action: WorkflowAction): Promise<string> => {
      if (!workflowRecording.isRecording) {
        throw new Error("Cannot record action: recording is not active");
      }

      setIsLoading(true);
      setError(null);
      try {
        const nodeId = await invoke<string>("workflow_record_action", {
          action,
        });
        await refreshWorkflowInfo();
        return nodeId;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to record action";
        setError(message);
        throw new Error(message);
      } finally {
        setIsLoading(false);
      }
    },
    [workflowRecording.isRecording],
  );

  /**
   * Generate Python code from the workflow
   */
  const generatePython = useCallback(async (): Promise<string> => {
    setIsLoading(true);
    setError(null);
    try {
      const code = await invoke<string>("workflow_generate_python");
      return code;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to generate Python code";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Generate Julia code from the workflow
   */
  const generateJulia = useCallback(async (): Promise<string> => {
    setIsLoading(true);
    setError(null);
    try {
      const code = await invoke<string>("workflow_generate_julia");
      return code;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to generate Julia code";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Export the workflow to JSON
   */
  const exportWorkflow = useCallback(async (): Promise<string> => {
    setIsLoading(true);
    setError(null);
    try {
      const json = await invoke<string>("workflow_export");
      return json;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to export workflow";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Import a workflow from JSON
   */
  const importWorkflow = useCallback(async (json: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await invoke("workflow_import", { json });
      await refreshWorkflowInfo();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to import workflow";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Get information about the current workflow
   */
  const getWorkflowInfo = useCallback(async (): Promise<WorkflowInfo> => {
    setIsLoading(true);
    setError(null);
    try {
      const info = await invoke<WorkflowInfo>("workflow_get_info");
      setWorkflowInfo(info);
      return info;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to get workflow info";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Refresh workflow info (internal helper)
   */
  const refreshWorkflowInfo = useCallback(async () => {
    try {
      const info = await invoke<WorkflowInfo>("workflow_get_info");
      setWorkflowInfo(info);
    } catch (err) {
      console.error("Failed to refresh workflow info:", err);
    }
  }, []);

  /**
   * Enable auto-recording (always-on circular buffer)
   */
  const enableAutoRecord = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await invoke("workflow_enable_auto_record");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to enable auto-recording";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Disable auto-recording
   */
  const disableAutoRecord = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await invoke("workflow_disable_auto_record");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to disable auto-recording";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Check if auto-recording is enabled
   */
  const isAutoRecording = useCallback(async (): Promise<boolean> => {
    try {
      return await invoke<boolean>("workflow_is_auto_recording");
    } catch (err) {
      console.error("Failed to check auto-recording status:", err);
      return false;
    }
  }, []);

  /**
   * Auto-record an action (called automatically when auto-recording is enabled)
   */
  const autoRecordAction = useCallback(
    async (action: WorkflowAction, activeFileId?: string) => {
      try {
        await invoke("workflow_auto_record", {
          action,
          activeFileId: activeFileId || null,
        });
      } catch (err) {
        console.error("Failed to auto-record action:", err);
      }
    },
    [],
  );

  /**
   * Get buffer statistics
   */
  const getBufferInfo = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const info = await invoke<{
        current_size: number;
        total_recorded: number;
        auto_recording_enabled: boolean;
      }>("workflow_get_buffer_info");
      return info;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to get buffer info";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Export workflow from buffer (last N minutes or all)
   */
  const exportFromBuffer = useCallback(
    async (workflowName: string, lastNMinutes?: number): Promise<string> => {
      setIsLoading(true);
      setError(null);
      try {
        const json = await invoke<string>("workflow_export_from_buffer", {
          workflowName,
          lastNMinutes: lastNMinutes || null,
        });
        return json;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to export from buffer";
        setError(message);
        throw new Error(message);
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  /**
   * Clear the action buffer
   */
  const clearBuffer = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await invoke("workflow_clear_buffer");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to clear buffer";
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Generate code from buffer
   */
  const generateCodeFromBuffer = useCallback(
    async (
      language: "python" | "julia" | "matlab" | "rust" | "r",
      workflowName: string,
      lastNMinutes?: number,
      optimize?: boolean,
    ): Promise<string> => {
      setIsLoading(true);
      setError(null);
      try {
        const code = await invoke<string>(
          "workflow_generate_code_from_buffer",
          {
            language,
            workflowName,
            lastNMinutes: lastNMinutes || null,
            optimize: optimize ?? true,
          },
        );
        return code;
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to generate code from buffer";
        setError(message);
        throw new Error(message);
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  return {
    // Recording state (from store)
    isRecording: workflowRecording.isRecording,
    isLoading,
    error,
    workflowInfo,

    // Recording controls
    recordAction,

    // Auto-recording controls
    enableAutoRecord,
    disableAutoRecord,
    isAutoRecording,
    autoRecordAction,
    getBufferInfo,
    exportFromBuffer,
    clearBuffer,
    generateCodeFromBuffer,

    // Workflow management
    newWorkflow,
    clearWorkflow,
    getWorkflowInfo,
    validateWorkflow,

    // Node management
    addNode,
    removeNode,
    getNode,
    getAllNodes,

    // Edge management
    addEdge,
    getAllEdges,

    // Analysis
    getTopologicalOrder,

    // Code generation
    generatePython,
    generateJulia,

    // Import/Export
    exportWorkflow,
    importWorkflow,
  };
}
