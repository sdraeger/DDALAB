// Tauri v2 API - properly integrated
// Dynamic imports to avoid SSR issues
import { loggers } from "@/lib/logger";

const getTauriAPI = async () => {
  if (typeof window === "undefined") return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return { invoke, appWindow: getCurrentWindow() };
};

export interface FileManagerState {
  selected_file: string | null;
  current_path: string[];
  selected_channels: string[];
  search_query: string;
  sort_by: string;
  sort_order: string;
  show_hidden: boolean;
}

export interface PlotState {
  visible_channels: string[];
  time_range: [number, number];
  amplitude_range: [number, number];
  zoom_level: number;
  annotations?: any[];
  color_scheme?: string;
  plot_mode?: string;
  filters?: Record<string, any>;
  preprocessing?: any;
}

export interface DDAState {
  selected_variants: string[];
  parameters: Record<string, any>;
  last_analysis_id: string | null;
}

export interface AppState {
  file_manager: FileManagerState;
  plot: PlotState;
  dda: DDAState;
  ui: Record<string, any>;
}

export interface AppPreferences {
  api_config: {
    url: string;
    timeout: number;
  };
  window_state: Record<string, any>;
  theme: string;
  use_https: boolean;
  /** Whether to show a warning dialog when closing the app during DDA analysis */
  warn_on_close_during_analysis: boolean;
  /** ISO date string of last update check */
  updates_last_checked?: string;
}

export enum NSGJobStatus {
  Pending = "pending",
  Submitted = "submitted",
  Queue = "queue",
  InputStaging = "inputstaging",
  Running = "running",
  Completed = "completed",
  Failed = "failed",
  Cancelled = "cancelled",
}

export interface NSGJob {
  id: string;
  nsg_job_id: string | null;
  tool: string;
  status: NSGJobStatus;
  created_at: string;
  submitted_at: string | null;
  completed_at: string | null;
  dda_params: Record<string, any>;
  input_file_path: string;
  output_files: string[];
  error_message: string | null;
  last_polled: string | null;
  progress: number | null;
}

// NOTE: This interface intentionally does NOT include actual credentials
// Only indicates presence to prevent credential exposure to frontend
export interface NSGCredentials {
  username: string;
  has_password: boolean;
  has_app_key: boolean;
}

export interface NSGResourceConfig {
  runtime_hours?: number;
  cores?: number;
  nodes?: number;
}

export interface NSGJobStats {
  total: number;
  pending: number;
  submitted: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export enum NotificationType {
  Info = "info",
  Success = "success",
  Warning = "warning",
  Error = "error",
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  notification_type: NotificationType;
  created_at: string;
  read: boolean;
  action_type?: string;
  action_data?: any;
}

export class TauriService {
  private static instance: TauriService;

  static getInstance(): TauriService {
    if (!TauriService.instance) {
      TauriService.instance = new TauriService();
    }
    return TauriService.instance;
  }

  async openAnalysisPreviewWindow(analysis: any): Promise<void> {
    try {
      const api = await getTauriAPI();
      if (!api) return;

      // Use Tauri's window API to create a new window
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");

      // Create window with analysis data
      const windowLabel = `analysis-preview-${analysis.id}`;

      const previewWindow = new WebviewWindow(windowLabel, {
        url: `/analysis-preview?analysisId=${analysis.id}`,
        title: `Analysis Preview - ${analysis.file_path ? analysis.file_path.split("/").pop() : analysis.id}`,
        width: 1200,
        height: 800,
        resizable: true,
        minimizable: true,
        maximizable: true,
        center: true,
        focus: true,
        decorations: true,
      });

      previewWindow.once("tauri://created", async () => {
        await api.invoke("store_analysis_preview_data", {
          windowId: windowLabel,
          analysisData: analysis,
        });
      });

      previewWindow.once("tauri://error", (e) => {
        loggers.tauri.error("Failed to create analysis preview window", {
          error: e,
        });
      });
    } catch (error) {
      loggers.tauri.error("Failed to open analysis preview window", { error });
    }
  }

  static async getAppState(): Promise<AppState> {
    try {
      const api = await getTauriAPI();
      if (!api) throw new Error("Tauri API not available");
      return await api.invoke("get_app_state");
    } catch (error) {
      loggers.tauri.error("Failed to get app state", { error });
      // Return default state
      return {
        file_manager: {
          selected_file: null,
          current_path: [],
          selected_channels: [],
          search_query: "",
          sort_by: "name",
          sort_order: "asc",
          show_hidden: false,
        },
        plot: {
          visible_channels: [],
          time_range: [0, 30],
          amplitude_range: [-100, 100],
          zoom_level: 1.0,
        },
        dda: {
          selected_variants: ["single_timeseries"],
          parameters: {},
          last_analysis_id: null,
        },
        ui: {},
      };
    }
  }

  static async updateFileManagerState(state: FileManagerState): Promise<void> {
    try {
      const api = await getTauriAPI();
      if (!api) return;
      await api.invoke("update_file_manager_state", {
        fileManagerState: state,
      });
    } catch (error) {
      loggers.tauri.error("Failed to update file manager state", { error });
    }
  }

  static async updatePlotState(state: PlotState): Promise<void> {
    try {
      const api = await getTauriAPI();
      if (!api) return;
      await api.invoke("update_plot_state", { plotState: state });
    } catch (error) {
      loggers.tauri.error("Failed to update plot state", { error });
    }
  }

  static async updateDDAState(state: DDAState): Promise<void> {
    try {
      const api = await getTauriAPI();
      if (!api) return;
      await api.invoke("update_dda_state", { ddaState: state });
    } catch (error) {
      loggers.tauri.error("Failed to update DDA state", { error });
    }
  }

  static async updateUIState(updates: Record<string, any>): Promise<void> {
    try {
      const api = await getTauriAPI();
      if (!api) return;
      await api.invoke("update_ui_state", { uiUpdates: updates });
    } catch (error) {
      loggers.tauri.error("Failed to update UI state", { error });
    }
  }

  static async checkApiConnection(url: string): Promise<boolean> {
    try {
      const api = await getTauriAPI();
      if (!api) return false;
      return await api.invoke("check_api_connection", { url });
    } catch (error) {
      loggers.api.error("Failed to check API connection", { error, url });
      return false;
    }
  }

  static async getAppPreferences(): Promise<AppPreferences> {
    try {
      const api = await getTauriAPI();
      if (!api) throw new Error("Tauri API not available");
      return await api.invoke("get_app_preferences");
    } catch (error) {
      loggers.tauri.error("Failed to get app preferences", { error });
      // Return consistent defaults where use_https matches the URL protocol
      return {
        api_config: {
          url: "https://localhost:8765", // Default to HTTPS
          timeout: 30,
        },
        window_state: {},
        theme: "auto",
        use_https: true, // Matches the HTTPS URL above
        warn_on_close_during_analysis: true, // Warn by default
      };
    }
  }

  static async saveAppPreferences(preferences: AppPreferences): Promise<void> {
    try {
      const api = await getTauriAPI();
      if (!api) throw new Error("Tauri API not available");
      await api.invoke("save_app_preferences", { preferences });
    } catch (error) {
      loggers.tauri.error("Failed to save app preferences", { error });
      throw error;
    }
  }

  static async openFileDialog(): Promise<string | null> {
    try {
      const api = await getTauriAPI();
      if (!api) return null;

      // Use the synchronous file dialog with proper extension filters
      // Supports: .edf, .fif, .set, .vhdr, .txt, .asc, .csv, .ascii
      const result = await api.invoke<string | null>("open_file_dialog_sync");
      return result;
    } catch (error) {
      loggers.tauri.error("Failed to open file dialog", { error });
      return null;
    }
  }

  static async showNotification(title: string, body: string): Promise<void> {
    try {
      const api = await getTauriAPI();
      if (!api) return;

      // Use Rust command which implements tauri-plugin-notification v2 API
      await api.invoke("show_notification", { title, body });
    } catch (error) {
      loggers.notifications.error("Failed to show notification", {
        error,
        title,
      });
    }
  }

  static async minimizeWindow(): Promise<void> {
    try {
      const api = await getTauriAPI();
      if (!api) return;
      await api.appWindow.minimize();
    } catch (error) {
      loggers.tauri.error("Failed to minimize window", { error });
    }
  }

  static async maximizeWindow(): Promise<void> {
    try {
      const api = await getTauriAPI();
      if (!api) return;
      await api.appWindow.toggleMaximize();
    } catch (error) {
      loggers.tauri.error("Failed to maximize window", { error });
    }
  }

  static async closeWindow(): Promise<void> {
    try {
      const api = await getTauriAPI();
      if (!api) return;
      await api.appWindow.close();
    } catch (error) {
      loggers.tauri.error("Failed to close window", { error });
    }
  }

  static async setWindowTitle(title: string): Promise<void> {
    try {
      const api = await getTauriAPI();
      if (!api) return;
      await api.appWindow.setTitle(title);
    } catch (error) {
      loggers.tauri.error("Failed to set window title", { error, title });
    }
  }

  // API Server Management (Unified Local/Remote)
  static async startLocalApiServer(
    port?: number,
    host?: string,
    dataDirectory?: string,
  ): Promise<any> {
    try {
      const api = await getTauriAPI();
      if (!api) throw new Error("Tauri API not available");

      const result = await api.invoke("start_local_api_server", {
        port,
        host,
        dataDirectory,
      });
      return result;
    } catch (error) {
      loggers.api.error("Failed to start local API server", {
        error,
        port,
        host,
      });
      throw error;
    }
  }

  static async stopLocalApiServer(): Promise<void> {
    try {
      const api = await getTauriAPI();
      if (!api) throw new Error("Tauri API not available");
      await api.invoke("stop_local_api_server");
    } catch (error) {
      loggers.api.error("Failed to stop local API server", { error });
      throw error;
    }
  }

  static async getApiStatus(): Promise<any> {
    try {
      const api = await getTauriAPI();
      if (!api) throw new Error("Tauri API not available");
      return await api.invoke("get_api_status");
    } catch (error) {
      loggers.api.error("Failed to get API status", { error });
      return null;
    }
  }

  static async getApiConfig(): Promise<any> {
    try {
      const api = await getTauriAPI();
      if (!api) throw new Error("Tauri API not available");
      return await api.invoke("get_api_config");
    } catch (error) {
      loggers.api.error("Failed to get API config", { error });
      return null;
    }
  }

  static async loadApiConfig(): Promise<any> {
    try {
      const api = await getTauriAPI();
      if (!api) throw new Error("Tauri API not available");
      return await api.invoke("load_api_config");
    } catch (error) {
      loggers.api.error("Failed to load API config", { error });
      return null;
    }
  }

  static async saveApiConfig(config: any): Promise<void> {
    try {
      const api = await getTauriAPI();
      if (!api) throw new Error("Tauri API not available");
      await api.invoke("save_api_config", { config });
    } catch (error) {
      loggers.api.error("Failed to save API config", { error });
      throw error;
    }
  }

  // Data directory management
  static async selectDataDirectory(): Promise<string> {
    try {
      // Use tauri-plugin-dialog for folder selection
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Data Directory",
      });

      if (!selected || typeof selected !== "string") {
        throw new Error("No directory selected");
      }

      // Save the selected directory
      await this.setDataDirectory(selected);
      return selected;
    } catch (error) {
      loggers.fileManager.error("Failed to select data directory", { error });
      throw error;
    }
  }

  static async getDataDirectory(): Promise<string> {
    try {
      const api = await getTauriAPI();
      if (!api) throw new Error("Tauri API not available");
      return await api.invoke("get_data_directory");
    } catch (error) {
      loggers.fileManager.error("Failed to get data directory", { error });
      throw error;
    }
  }

  static async setDataDirectory(path: string): Promise<void> {
    try {
      const api = await getTauriAPI();
      if (!api) throw new Error("Tauri API not available");
      await api.invoke("set_data_directory", { path });
    } catch (error) {
      loggers.fileManager.error("Failed to set data directory", {
        error,
        path,
      });
      throw error;
    }
  }

  static isTauri(): boolean {
    if (typeof window === "undefined") return false;

    // Only return true if we have actual Tauri indicators
    // Do NOT assume Tauri based on port number - this breaks E2E tests
    const hasActualTauriIndicators =
      "__TAURI__" in window ||
      "__TAURI_METADATA__" in window ||
      window.location.protocol === "tauri:" ||
      Boolean(window.navigator.userAgent?.includes("Tauri"));

    return hasActualTauriIndicators;
  }

  // Update Commands
  static async checkForUpdates(): Promise<{
    available: boolean;
    current_version: string;
    latest_version?: string;
    release_notes?: string;
    release_date?: string;
    download_url?: string;
  }> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    return await api.invoke("check_for_updates");
  }

  // Get app version
  static async getAppVersion(): Promise<string> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    return await api.invoke("get_app_version");
  }

  // Native Update Commands (uses Tauri updater plugin)
  static async checkNativeUpdate(): Promise<{
    available: boolean;
    current_version: string;
    latest_version?: string;
    release_notes?: string;
    release_date?: string;
  }> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    return await api.invoke("check_native_update");
  }

  static async downloadAndInstallUpdate(): Promise<void> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    await api.invoke("download_and_install_update");
  }

  // Open URL in default browser
  static async openUrl(url: string): Promise<void> {
    if (typeof window === "undefined") return;

    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
    } catch (error) {
      loggers.tauri.error("Failed to open URL", { error, url });
      throw error;
    }
  }

  // Debug Commands
  static async openLogsFolder(): Promise<void> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    await api.invoke("open_logs_folder");
  }

  static async getLogsPath(): Promise<string> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    return await api.invoke("get_logs_path");
  }

  static async readLogsContent(): Promise<string> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    return await api.invoke("read_logs_content");
  }

  // NSG (Neuroscience Gateway) Commands

  static async saveNSGCredentials(
    username: string,
    password: string,
    appKey: string,
  ): Promise<void> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    await api.invoke("save_nsg_credentials", { username, password, appKey });
  }

  static async getNSGCredentials(): Promise<NSGCredentials | null> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    return await api.invoke("get_nsg_credentials");
  }

  static async hasNSGCredentials(): Promise<boolean> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    return await api.invoke("has_nsg_credentials");
  }

  static async deleteNSGCredentials(): Promise<void> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    await api.invoke("delete_nsg_credentials");
  }

  static async testNSGConnection(): Promise<boolean> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    return await api.invoke("test_nsg_connection");
  }

  static async createNSGJob(
    tool: string,
    ddaParams: Record<string, any>,
    inputFilePath: string,
    runtimeHours?: number,
    cores?: number,
    nodes?: number,
  ): Promise<string> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");

    const params: Record<string, any> = {
      tool,
      ddaParams: ddaParams,
      inputFilePath: inputFilePath,
    };

    if (runtimeHours !== undefined) params.runtimeHours = runtimeHours;
    if (cores !== undefined) params.cores = cores;
    if (nodes !== undefined) params.nodes = nodes;

    return await api.invoke("create_nsg_job", params);
  }

  static async submitNSGJob(jobId: string): Promise<NSGJob> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    return await api.invoke("submit_nsg_job", { jobId });
  }

  static async getNSGJobStatus(jobId: string): Promise<NSGJob> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    return await api.invoke("get_nsg_job_status", { jobId });
  }

  static async listNSGJobs(): Promise<NSGJob[]> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    return await api.invoke("list_nsg_jobs");
  }

  static async listActiveNSGJobs(): Promise<NSGJob[]> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    return await api.invoke("list_active_nsg_jobs");
  }

  static async cancelNSGJob(jobId: string): Promise<void> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    await api.invoke("cancel_nsg_job", { jobId });
  }

  static async downloadNSGResults(jobId: string): Promise<string[]> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    return await api.invoke("download_nsg_results", { jobId });
  }

  static async extractNSGTarball(
    jobId: string,
    tarPath: string,
  ): Promise<string[]> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    return await api.invoke("extract_nsg_tarball", { jobId, tarPath });
  }

  static async readTextFile(filePath: string): Promise<string> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    return await readTextFile(filePath);
  }

  static async deleteNSGJob(jobId: string): Promise<void> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    await api.invoke("delete_nsg_job", { jobId });
  }

  static async pollNSGJobs(): Promise<void> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    await api.invoke("poll_nsg_jobs");
  }

  static async getNSGJobStats(): Promise<NSGJobStats> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    return await api.invoke("get_nsg_job_stats");
  }

  static async cleanupPendingNSGJobs(): Promise<number> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    return await api.invoke("cleanup_pending_nsg_jobs");
  }

  // Notification methods
  static async createNotification(
    title: string,
    message: string,
    notificationType: NotificationType = NotificationType.Info,
    actionType?: string,
    actionData?: any,
  ): Promise<Notification> {
    try {
      const api = await getTauriAPI();
      if (!api) {
        throw new Error("Not running in Tauri environment");
      }
      return await api.invoke("create_notification", {
        title,
        message,
        notificationType,
        actionType,
        actionData,
      });
    } catch (error) {
      loggers.notifications.error("Failed to create notification", {
        error,
        title,
      });
      throw error;
    }
  }

  static async listNotifications(limit?: number): Promise<Notification[]> {
    try {
      const api = await getTauriAPI();
      if (!api) {
        throw new Error("Not running in Tauri environment");
      }
      return await api.invoke("list_notifications", { limit });
    } catch (error) {
      loggers.notifications.error("Failed to list notifications", {
        error,
        limit,
      });
      throw error;
    }
  }

  static async getUnreadCount(): Promise<number> {
    try {
      const api = await getTauriAPI();
      if (!api) {
        throw new Error("Not running in Tauri environment");
      }
      return await api.invoke("get_unread_count");
    } catch (error) {
      loggers.notifications.error("Failed to get unread count", { error });
      throw error;
    }
  }

  static async markNotificationRead(id: string): Promise<void> {
    try {
      const api = await getTauriAPI();
      if (!api) {
        throw new Error("Not running in Tauri environment");
      }
      return await api.invoke("mark_notification_read", { id });
    } catch (error) {
      loggers.notifications.error("Failed to mark notification as read", {
        error,
        id,
      });
      throw error;
    }
  }

  static async markAllNotificationsRead(): Promise<void> {
    try {
      const api = await getTauriAPI();
      if (!api) {
        throw new Error("Not running in Tauri environment");
      }
      return await api.invoke("mark_all_notifications_read");
    } catch (error) {
      loggers.notifications.error("Failed to mark all notifications as read", {
        error,
      });
      throw error;
    }
  }

  static async deleteNotification(id: string): Promise<void> {
    try {
      const api = await getTauriAPI();
      if (!api) {
        throw new Error("Not running in Tauri environment");
      }
      return await api.invoke("delete_notification", { id });
    } catch (error) {
      loggers.notifications.error("Failed to delete notification", {
        error,
        id,
      });
      throw error;
    }
  }

  static async deleteOldNotifications(days: number): Promise<number> {
    try {
      const api = await getTauriAPI();
      if (!api) {
        throw new Error("Not running in Tauri environment");
      }
      return await api.invoke("delete_old_notifications", { days });
    } catch (error) {
      loggers.notifications.error("Failed to delete old notifications", {
        error,
        days,
      });
      throw error;
    }
  }

  // Annotation export/import methods
  static async exportAnnotations(
    filePath: string,
    format: "json" | "csv" = "json",
  ): Promise<string | null> {
    try {
      const api = await getTauriAPI();
      if (!api) {
        throw new Error("Not running in Tauri environment");
      }
      return await api.invoke("export_annotations", { filePath, format });
    } catch (error) {
      loggers.annotations.error("Failed to export annotations", {
        error,
        filePath,
        format,
      });
      throw error;
    }
  }

  static async exportAllAnnotations(
    format: "json" | "csv" = "json",
  ): Promise<string | null> {
    try {
      const api = await getTauriAPI();
      if (!api) {
        throw new Error("Not running in Tauri environment");
      }
      return await api.invoke("export_all_annotations", { format });
    } catch (error) {
      loggers.annotations.error("Failed to export all annotations", {
        error,
        format,
      });
      throw error;
    }
  }

  static async previewImportAnnotations(targetFilePath: string): Promise<{
    source_file: string;
    target_file: string;
    annotations: Array<{
      id: string;
      position: number;
      label: string;
      description?: string;
      color?: string;
      channel?: string;
      status: "new" | "duplicate" | "near_duplicate";
      similarity_score: number;
      closest_existing?: {
        label: string;
        position: number;
        time_diff: number;
      };
    }>;
    warnings: string[];
    summary: {
      total: number;
      new: number;
      duplicates: number;
      near_duplicates: number;
    };
  } | null> {
    try {
      const api = await getTauriAPI();
      if (!api) {
        throw new Error("Not running in Tauri environment");
      }
      return await api.invoke("preview_import_annotations", { targetFilePath });
    } catch (error) {
      loggers.annotations.error("Failed to preview annotations", {
        error,
        targetFilePath,
      });
      throw error;
    }
  }

  static async importAnnotations(targetFilePath: string): Promise<{
    total_in_file: number;
    imported: number;
    skipped_duplicates: number;
    skipped_near_duplicates: number;
    warnings: string[];
  }> {
    try {
      const api = await getTauriAPI();
      if (!api) {
        throw new Error("Not running in Tauri environment");
      }
      return await api.invoke("import_annotations", { targetFilePath });
    } catch (error) {
      loggers.annotations.error("Failed to import annotations", {
        error,
        targetFilePath,
      });
      throw error;
    }
  }

  static async importSelectedAnnotations(
    importFilePath: string,
    targetFilePath: string,
    selectedIds: string[],
  ): Promise<number> {
    try {
      const api = await getTauriAPI();
      if (!api) {
        throw new Error("Not running in Tauri environment");
      }
      return await api.invoke("import_selected_annotations", {
        importFilePath,
        targetFilePath,
        selectedIds,
      });
    } catch (error) {
      loggers.annotations.error("Failed to import selected annotations", {
        error,
        importFilePath,
        targetFilePath,
      });
      throw error;
    }
  }

  static async saveDDAExportFile(
    content: string,
    format: "csv" | "json",
    defaultFilename: string,
  ): Promise<string | null> {
    try {
      const api = await getTauriAPI();
      if (!api) {
        throw new Error("Not running in Tauri environment");
      }
      return await api.invoke("save_dda_export_file", {
        content,
        format,
        defaultFilename,
      });
    } catch (error) {
      loggers.export.error("Failed to save DDA export", {
        error,
        format,
        defaultFilename,
      });
      throw error;
    }
  }

  static async savePlotExportFile(
    imageData: Uint8Array,
    format: "png" | "svg" | "pdf",
    defaultFilename: string,
  ): Promise<string | null> {
    try {
      const api = await getTauriAPI();
      if (!api) {
        throw new Error("Not running in Tauri environment");
      }
      return await api.invoke("save_plot_export_file", {
        imageData: Array.from(imageData),
        format,
        defaultFilename,
      });
    } catch (error) {
      loggers.export.error("Failed to save plot export", {
        error,
        format,
        defaultFilename,
      });
      throw error;
    }
  }

  static async deleteAnnotation(annotationId: string): Promise<void> {
    try {
      const api = await getTauriAPI();
      if (!api) {
        throw new Error("Not running in Tauri environment");
      }
      await api.invoke("delete_annotation", { annotationId });
    } catch (error) {
      loggers.annotations.error("Failed to delete annotation", {
        error,
        annotationId,
      });
      throw error;
    }
  }

  static async getAllAnnotations(): Promise<
    Record<
      string,
      {
        global_annotations: Array<{
          id: string;
          position: number;
          label: string;
          color?: string;
          description?: string;
          visible_in_plots: string[];
        }>;
        channel_annotations: Record<
          string,
          Array<{
            id: string;
            position: number;
            label: string;
            color?: string;
            description?: string;
            visible_in_plots: string[];
          }>
        >;
      }
    >
  > {
    try {
      const api = await getTauriAPI();
      if (!api) {
        throw new Error("Not running in Tauri environment");
      }
      return await api.invoke("get_all_annotations");
    } catch (error) {
      loggers.annotations.error("Failed to get all annotations", { error });
      throw error;
    }
  }

  static async selectDirectory(): Promise<string | null> {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Output Directory",
      });

      if (!selected || typeof selected !== "string") {
        return null;
      }

      return selected;
    } catch (error) {
      loggers.fileManager.error("Failed to select directory", { error });
      throw error;
    }
  }

  static async segmentFile(params: {
    filePath: string;
    startTime: number;
    startUnit: "seconds" | "samples";
    endTime: number;
    endUnit: "seconds" | "samples";
    outputDirectory: string;
    outputFormat: "same" | "edf" | "csv" | "ascii";
    outputFilename: string;
    selectedChannels: number[] | null;
  }): Promise<{ outputPath: string }> {
    try {
      const api = await getTauriAPI();
      if (!api) {
        throw new Error("Not running in Tauri environment");
      }

      return await api.invoke("segment_file", {
        params: {
          filePath: params.filePath,
          startTime: params.startTime,
          startUnit: params.startUnit,
          endTime: params.endTime,
          endUnit: params.endUnit,
          outputDirectory: params.outputDirectory,
          outputFormat: params.outputFormat,
          outputFilename: params.outputFilename,
          selectedChannels: params.selectedChannels,
        },
      });
    } catch (error) {
      loggers.fileManager.error("Failed to segment file", {
        error,
        filePath: params.filePath,
      });
      throw error;
    }
  }

  static async cancelSegmentFile(): Promise<void> {
    try {
      const api = await getTauriAPI();
      if (!api) return;
      await api.invoke("cancel_segment_file");
    } catch (error) {
      loggers.fileManager.error("Failed to cancel segment file", { error });
    }
  }

  // CLI Install/Uninstall Commands
  static async installCli(): Promise<string> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    return await api.invoke("install_cli");
  }

  static async uninstallCli(): Promise<string> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    return await api.invoke("uninstall_cli");
  }

  static async getCliInstallStatus(): Promise<boolean> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    return await api.invoke("cli_install_status");
  }

  // Python/MNE Environment Commands
  static async detectPythonEnvironment(): Promise<{
    detected: boolean;
    pythonPath: string | null;
    hasMne: boolean;
    mneVersion: string | null;
  }> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    return await api.invoke("detect_python_environment");
  }

  static async testPythonPath(path: string): Promise<{
    detected: boolean;
    pythonPath: string | null;
    hasMne: boolean;
    mneVersion: string | null;
  }> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    return await api.invoke("test_python_path", { path });
  }

  // Git-annex support
  static async checkAnnexPlaceholder(filePath: string): Promise<boolean> {
    try {
      const api = await getTauriAPI();
      if (!api) return false;
      return await api.invoke("check_annex_placeholder", { filePath });
    } catch (error) {
      loggers.fileManager.error("Failed to check annex placeholder", {
        error,
        filePath,
      });
      return false;
    }
  }

  static async runGitAnnexGet(
    filePath: string,
  ): Promise<{ success: boolean; output: string; error?: string }> {
    const api = await getTauriAPI();
    if (!api) throw new Error("Not running in Tauri environment");
    return await api.invoke("run_git_annex_get", { filePath });
  }
}
