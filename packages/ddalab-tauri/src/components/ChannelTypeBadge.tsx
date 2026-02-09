import { memo } from "react";
import { cn } from "@/lib/utils";

/** Color mapping for channel types. */
const CHANNEL_TYPE_COLORS: Record<
  string,
  { bg: string; text: string; border: string }
> = {
  EEG: {
    bg: "bg-blue-100 dark:bg-blue-900/40",
    text: "text-blue-700 dark:text-blue-300",
    border: "border-blue-300 dark:border-blue-700",
  },
  MEG: {
    bg: "bg-purple-100 dark:bg-purple-900/40",
    text: "text-purple-700 dark:text-purple-300",
    border: "border-purple-300 dark:border-purple-700",
  },
  EOG: {
    bg: "bg-green-100 dark:bg-green-900/40",
    text: "text-green-700 dark:text-green-300",
    border: "border-green-300 dark:border-green-700",
  },
  ECG: {
    bg: "bg-red-100 dark:bg-red-900/40",
    text: "text-red-700 dark:text-red-300",
    border: "border-red-300 dark:border-red-700",
  },
  EMG: {
    bg: "bg-orange-100 dark:bg-orange-900/40",
    text: "text-orange-700 dark:text-orange-300",
    border: "border-orange-300 dark:border-orange-700",
  },
  STIM: {
    bg: "bg-gray-100 dark:bg-gray-800/40",
    text: "text-gray-600 dark:text-gray-400",
    border: "border-gray-300 dark:border-gray-600",
  },
  RESP: {
    bg: "bg-teal-100 dark:bg-teal-900/40",
    text: "text-teal-700 dark:text-teal-300",
    border: "border-teal-300 dark:border-teal-700",
  },
  MISC: {
    bg: "bg-gray-100 dark:bg-gray-800/40",
    text: "text-gray-500 dark:text-gray-400",
    border: "border-gray-300 dark:border-gray-600",
  },
};

interface ChannelTypeBadgeProps {
  type: string;
  className?: string;
}

/** Small color-coded badge for channel type (EEG, MEG, EOG, etc.). */
export const ChannelTypeBadge = memo(function ChannelTypeBadge({
  type,
  className,
}: ChannelTypeBadgeProps) {
  if (!type || type === "Unknown") return null;

  const colors = CHANNEL_TYPE_COLORS[type];
  if (!colors) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1 py-0 text-[10px] font-medium leading-4 border",
        colors.bg,
        colors.text,
        colors.border,
        className,
      )}
    >
      {type}
    </span>
  );
});
