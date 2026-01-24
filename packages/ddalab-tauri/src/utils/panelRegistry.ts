import type { LucideIcon } from "lucide-react";

export interface PanelContext {
  filePath?: string;
  channels?: string[];
  sampleRate?: number;
  analysisId?: string;
}

export interface PanelDefinition {
  id: string;
  title: string;
  icon: LucideIcon;
  category: "visualization" | "analysis" | "data";
  defaultSize: { width: number; height: number };
  minSize?: { width: number; height: number };
  popoutUrl: string;
  getInitialData?: (context: PanelContext) => any;
  serializeState?: (data: any) => any;
  deserializeState?: (saved: any) => any;
  // Future layout engine hooks
  dockable?: boolean;
  allowMultiple?: boolean;
}

const PANEL_REGISTRY = new Map<string, PanelDefinition>();

export function registerPanel(definition: PanelDefinition): void {
  if (PANEL_REGISTRY.has(definition.id)) {
    console.warn(`Panel "${definition.id}" is already registered, overwriting.`);
  }
  PANEL_REGISTRY.set(definition.id, definition);
}

export function getPanel(id: string): PanelDefinition | undefined {
  return PANEL_REGISTRY.get(id);
}

export function getAllPanels(): PanelDefinition[] {
  return Array.from(PANEL_REGISTRY.values());
}

export function getPanelsByCategory(
  category: PanelDefinition["category"],
): PanelDefinition[] {
  return getAllPanels().filter((p) => p.category === category);
}

export function getPanelIds(): string[] {
  return Array.from(PANEL_REGISTRY.keys());
}
