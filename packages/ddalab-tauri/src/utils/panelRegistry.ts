import type { LucideIcon } from "lucide-react";

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface PanelContext {
  filePath?: string;
  channels?: string[];
  sampleRate?: number;
  analysisId?: string;
  [key: string]: unknown;
}

export interface PanelLifecycle<TData = unknown> {
  /** Called when panel window is created */
  onMount?: (windowId: string, data: TData) => void | Promise<void>;
  /** Called when panel window is closed */
  onUnmount?: (windowId: string) => void | Promise<void>;
  /** Called when panel receives new data */
  onDataChange?: (windowId: string, data: TData) => void | Promise<void>;
  /** Validate data before sending to panel */
  validateData?: (data: unknown) => data is TData;
}

export interface PanelDefinition<TData = unknown> {
  /** Unique identifier (e.g., "phase-space", "my-plugin:custom-view") */
  id: string;
  /** Display title */
  title: string;
  /** Icon for UI display */
  icon: LucideIcon;
  /** Panel category for grouping */
  category: "visualization" | "analysis" | "data" | "plugin";
  /** Default window dimensions */
  defaultSize: { width: number; height: number };
  /** Minimum window dimensions */
  minSize?: { width: number; height: number };
  /** Route for popout window */
  popoutUrl: string;
  /** Namespace for plugin panels (e.g., "my-plugin") */
  namespace?: string;
  /** Lifecycle hooks */
  lifecycle?: PanelLifecycle<TData>;
  /** Transform context to initial panel data */
  getInitialData?: (context: PanelContext) => TData;
  /** Serialize panel state for persistence */
  serializeState?: (data: TData) => unknown;
  /** Deserialize saved state */
  deserializeState?: (saved: unknown) => TData;
  /** Future: can this panel be docked? */
  dockable?: boolean;
  /** Future: allow multiple instances? */
  allowMultiple?: boolean;
  /** Future: panel-specific toolbar actions */
  toolbarActions?: PanelToolbarAction[];
}

export interface PanelToolbarAction {
  id: string;
  label: string;
  icon?: LucideIcon;
  shortcut?: string;
  onClick: (windowId: string) => void;
}

type PanelRegistryListener = (event: PanelRegistryEvent) => void;

export type PanelRegistryEvent =
  | { type: "registered"; panelId: string }
  | { type: "unregistered"; panelId: string }
  | { type: "updated"; panelId: string };

// ============================================================================
// Panel Registry Implementation
// ============================================================================

class PanelRegistryImpl {
  private panels = new Map<string, PanelDefinition<unknown>>();
  private listeners = new Set<PanelRegistryListener>();
  private namespaces = new Map<string, Set<string>>();

  /**
   * Register a panel definition
   */
  register<TData = unknown>(definition: PanelDefinition<TData>): void {
    this.validatePanelId(definition.id);

    if (this.panels.has(definition.id)) {
      console.warn(
        `[PanelRegistry] Panel "${definition.id}" already registered, overwriting.`,
      );
    }

    this.panels.set(definition.id, definition as PanelDefinition<unknown>);

    // Track namespace membership
    if (definition.namespace) {
      if (!this.namespaces.has(definition.namespace)) {
        this.namespaces.set(definition.namespace, new Set());
      }
      this.namespaces.get(definition.namespace)!.add(definition.id);
    }

    this.emit({ type: "registered", panelId: definition.id });
  }

  /**
   * Unregister a panel (useful for plugin cleanup)
   */
  unregister(panelId: string): boolean {
    const panel = this.panels.get(panelId);
    if (!panel) return false;

    this.panels.delete(panelId);

    if (panel.namespace) {
      this.namespaces.get(panel.namespace)?.delete(panelId);
    }

    this.emit({ type: "unregistered", panelId });
    return true;
  }

  /**
   * Unregister all panels from a namespace (plugin unload)
   */
  unregisterNamespace(namespace: string): string[] {
    const panelIds = this.namespaces.get(namespace);
    if (!panelIds) return [];

    const removed: string[] = [];
    for (const panelId of panelIds) {
      if (this.unregister(panelId)) {
        removed.push(panelId);
      }
    }

    this.namespaces.delete(namespace);
    return removed;
  }

  /**
   * Get a panel definition by ID
   */
  get<TData = unknown>(panelId: string): PanelDefinition<TData> | undefined {
    return this.panels.get(panelId) as PanelDefinition<TData> | undefined;
  }

  /**
   * Get all registered panels
   */
  getAll(): PanelDefinition<unknown>[] {
    return Array.from(this.panels.values());
  }

  /**
   * Get panels by category
   */
  getByCategory(
    category: PanelDefinition["category"],
  ): PanelDefinition<unknown>[] {
    return this.getAll().filter((p) => p.category === category);
  }

  /**
   * Get panels by namespace
   */
  getByNamespace(namespace: string): PanelDefinition<unknown>[] {
    const panelIds = this.namespaces.get(namespace);
    if (!panelIds) return [];

    return Array.from(panelIds)
      .map((id) => this.panels.get(id))
      .filter((p): p is PanelDefinition<unknown> => p !== undefined);
  }

  /**
   * Get all panel IDs
   */
  getIds(): string[] {
    return Array.from(this.panels.keys());
  }

  /**
   * Get all registered namespaces
   */
  getNamespaces(): string[] {
    return Array.from(this.namespaces.keys());
  }

  /**
   * Check if a panel is registered
   */
  has(panelId: string): boolean {
    return this.panels.has(panelId);
  }

  /**
   * Subscribe to registry changes
   */
  subscribe(listener: PanelRegistryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: PanelRegistryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("[PanelRegistry] Listener error:", error);
      }
    }
  }

  private validatePanelId(id: string): void {
    if (!id || typeof id !== "string") {
      throw new Error("Panel ID must be a non-empty string");
    }

    // Allow format: "name" or "namespace:name"
    const validFormat = /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)?$/;
    if (!validFormat.test(id)) {
      throw new Error(
        `Invalid panel ID "${id}". Must be lowercase alphanumeric with hyphens, optionally namespaced (e.g., "my-panel" or "plugin:my-panel")`,
      );
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const panelRegistry = new PanelRegistryImpl();

// Convenience functions (backward compatible)
export const registerPanel = panelRegistry.register.bind(panelRegistry);
export const getPanel = panelRegistry.get.bind(panelRegistry);
export const getAllPanels = panelRegistry.getAll.bind(panelRegistry);
export const getPanelsByCategory =
  panelRegistry.getByCategory.bind(panelRegistry);
export const getPanelIds = panelRegistry.getIds.bind(panelRegistry);
export const hasPanel = panelRegistry.has.bind(panelRegistry);
