export function getFormattedCommentsHtml(comments: string[]): string {
  if (!comments || comments.length === 0) {
    return "<p><em>No description provided.</em></p>";
  }
  return comments
    .map((comment) => {
      let processedComment = comment;
      processedComment = processedComment.replace(
        /\*\*(.*?)\*\*/g,
        "<strong>$1</strong>"
      );
      processedComment = processedComment.replace(/__(.*?)__/g, "<em>$1</em>");
      processedComment = processedComment.replace(
        /\*([^\s*][^\*]*?)\*/g,
        "<strong>$1</strong>"
      );
      processedComment = processedComment.replace(
        /_([^\s_][^_]*?)_/g,
        "<em>$1</em>"
      );
      return processedComment;
    })
    .join("<br />");
}

export function formatTimestamp(): string {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, "0")}:${now
    .getMinutes()
    .toString()
    .padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
}

// Interface for parsed .env entries (from renderer.ts)
export interface ParsedEnvEntry {
  key: string;
  value: string;
  comments: string[];
}

// User Selections (from renderer.ts)
export interface UserSelections {
  setupType: "" | "automatic" | "manual" | "docker";
  dataLocation: string;
  projectLocation: string;
  envVariables: { [key: string]: string };
  // Docker configuration fields
  webPort?: string;
  apiPort?: string;
  dbPassword?: string;
  minioPassword?: string;
  traefikEmail?: string;
  useDockerHub?: boolean;
  authMode?: string;
  // Potentially add other state installer might need, e.g. installationLog
  installationLog?: string[];
}

// Import ElectronAPI from preload to avoid duplication
export type { ElectronAPI } from "../../preload";
