import type { DDAResult } from "@/types/api";

const PAPER_BUNDLE_VERSION = "1.0.0";

export interface PaperBundleContext {
  appVersion: string;
  selectedVariantId: string | null;
  selectedVariantName: string | null;
  selectedChannels: string[];
  viewMode: string;
  colorScheme: string;
}

export interface PaperReproBundle {
  bundle_version: string;
  generated_at: string;
  application: {
    name: string;
    version: string;
  };
  analysis: {
    id: string;
    name: string | null;
    created_at: string;
    file_path: string;
    status: string;
    parameters: Record<string, unknown>;
    variant_count: number;
    channel_count: number;
  };
  active_view: {
    variant_id: string | null;
    variant_name: string | null;
    selected_channels: string[];
    view_mode: string;
    color_scheme: string;
  };
  reviewer_checklist: string[];
  evidence_fingerprint: string;
}

function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function buildEvidenceString(
  result: DDAResult,
  context: PaperBundleContext,
): string {
  const payload = {
    id: result.id,
    created_at: result.created_at,
    file_path: result.file_path,
    variants: result.parameters.variants,
    delays: result.parameters.delay_list,
    window_length: result.parameters.window_length,
    window_step: result.parameters.window_step,
    selected_variant: context.selectedVariantId,
    selected_channels: context.selectedChannels,
  };
  return JSON.stringify(payload);
}

export function createPaperReproBundle(
  result: DDAResult,
  context: PaperBundleContext,
): PaperReproBundle {
  const evidenceFingerprint = fnv1aHash(buildEvidenceString(result, context));

  return {
    bundle_version: PAPER_BUNDLE_VERSION,
    generated_at: new Date().toISOString(),
    application: {
      name: "DDALAB",
      version: context.appVersion,
    },
    analysis: {
      id: result.id,
      name: result.name ?? null,
      created_at: result.created_at,
      file_path: result.file_path,
      status: result.status,
      parameters: result.parameters as unknown as Record<string, unknown>,
      variant_count: result.results.variants.length,
      channel_count: result.channels.length,
    },
    active_view: {
      variant_id: context.selectedVariantId,
      variant_name: context.selectedVariantName,
      selected_channels: context.selectedChannels,
      view_mode: context.viewMode,
      color_scheme: context.colorScheme,
    },
    reviewer_checklist: [
      "Import snapshot or load the same source file.",
      "Confirm variant/mode and channel selection match this bundle.",
      "Re-run analysis and compare transition timing and channel patterns.",
      "Export JSON/CSV and verify consistency with expected workflow artifacts.",
    ],
    evidence_fingerprint: evidenceFingerprint,
  };
}

export function getDefaultPaperBundleFilename(result: DDAResult): string {
  const safeName = (result.name || result.id.slice(0, 8))
    .replace(/[^a-z0-9_-]/gi, "_")
    .toLowerCase();
  return `dda_paper_bundle_${safeName}.json`;
}
