/**
 * Shared constants for collaboration components
 * Following DRY principle - single source of truth
 */
import type { ShareableContentType } from "@/types/sync";
import {
  FileBarChart,
  FileText,
  GitBranch,
  Settings2,
  Database,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Icons mapped to each shareable content type
 * Used across SharedWithMe, MyShares, and other collaboration components
 */
export const CONTENT_TYPE_ICONS: Record<ShareableContentType, LucideIcon> = {
  dda_result: FileBarChart,
  annotation: FileText,
  workflow: GitBranch,
  parameter_set: Settings2,
  data_segment: Database,
};

/**
 * Timeout duration for copy feedback (in milliseconds)
 * Standardized across all copy-to-clipboard interactions
 */
export const COPY_FEEDBACK_TIMEOUT_MS = 2000;

/**
 * Default number of days for share expiry options
 */
export const SHARE_EXPIRY_OPTIONS = [
  { value: "1", label: "1 day" },
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
] as const;
