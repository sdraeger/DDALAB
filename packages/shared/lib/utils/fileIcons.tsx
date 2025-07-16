import {
  File,
  Folder,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileCode,
  FileSpreadsheet,
  FileArchive,
  FileJson,
  Database,
  Zap,
} from "lucide-react";

export interface FileIconProps {
  name: string;
  isDirectory: boolean;
  extension?: string;
  className?: string;
}

/**
 * Get the appropriate icon for a file or directory based on its type and extension
 */
export function getFileIcon({
  name,
  isDirectory,
  extension,
  className = "h-4 w-4",
}: FileIconProps) {
  if (isDirectory) {
    return <Folder className={`${className} text-blue-500`} />;
  }

  // Extract extension if not provided
  const fileExtension = extension || name.split(".").pop()?.toLowerCase() || "";

  // Define file type mappings
  const iconMap: Record<string, { icon: any; color: string }> = {
    // EDF and medical files
    edf: { icon: Zap, color: "text-green-500" },
    ascii: { icon: FileText, color: "text-green-600" },

    // Text and documentation
    txt: { icon: FileText, color: "text-gray-500" },
    md: { icon: FileText, color: "text-blue-600" },
    doc: { icon: FileText, color: "text-blue-700" },
    docx: { icon: FileText, color: "text-blue-700" },
    rtf: { icon: FileText, color: "text-gray-600" },
    pdf: { icon: FileText, color: "text-red-600" },

    // Code files
    js: { icon: FileCode, color: "text-yellow-500" },
    ts: { icon: FileCode, color: "text-blue-500" },
    jsx: { icon: FileCode, color: "text-cyan-500" },
    tsx: { icon: FileCode, color: "text-cyan-600" },
    py: { icon: FileCode, color: "text-green-600" },
    java: { icon: FileCode, color: "text-red-500" },
    cpp: { icon: FileCode, color: "text-blue-600" },
    c: { icon: FileCode, color: "text-blue-600" },
    css: { icon: FileCode, color: "text-blue-400" },
    html: { icon: FileCode, color: "text-orange-500" },
    xml: { icon: FileCode, color: "text-orange-600" },

    // Data and configuration
    json: { icon: FileJson, color: "text-yellow-500" },
    yaml: { icon: FileCode, color: "text-purple-500" },
    yml: { icon: FileCode, color: "text-purple-500" },
    toml: { icon: FileCode, color: "text-gray-600" },
    ini: { icon: FileCode, color: "text-gray-600" },
    conf: { icon: FileCode, color: "text-gray-600" },
    env: { icon: FileCode, color: "text-green-500" },

    // Images
    jpg: { icon: FileImage, color: "text-pink-500" },
    jpeg: { icon: FileImage, color: "text-pink-500" },
    png: { icon: FileImage, color: "text-pink-500" },
    gif: { icon: FileImage, color: "text-pink-500" },
    svg: { icon: FileImage, color: "text-purple-500" },
    bmp: { icon: FileImage, color: "text-pink-500" },
    webp: { icon: FileImage, color: "text-pink-500" },
    ico: { icon: FileImage, color: "text-pink-500" },

    // Audio
    mp3: { icon: FileAudio, color: "text-purple-500" },
    wav: { icon: FileAudio, color: "text-purple-500" },
    flac: { icon: FileAudio, color: "text-purple-500" },
    aac: { icon: FileAudio, color: "text-purple-500" },
    ogg: { icon: FileAudio, color: "text-purple-500" },

    // Video
    mp4: { icon: FileVideo, color: "text-red-500" },
    avi: { icon: FileVideo, color: "text-red-500" },
    mkv: { icon: FileVideo, color: "text-red-500" },
    mov: { icon: FileVideo, color: "text-red-500" },
    wmv: { icon: FileVideo, color: "text-red-500" },
    flv: { icon: FileVideo, color: "text-red-500" },

    // Spreadsheets
    xls: { icon: FileSpreadsheet, color: "text-green-600" },
    xlsx: { icon: FileSpreadsheet, color: "text-green-600" },
    csv: { icon: FileSpreadsheet, color: "text-green-500" },

    // Archives
    zip: { icon: FileArchive, color: "text-orange-500" },
    rar: { icon: FileArchive, color: "text-orange-500" },
    tar: { icon: FileArchive, color: "text-orange-500" },
    gz: { icon: FileArchive, color: "text-orange-500" },
    "7z": { icon: FileArchive, color: "text-orange-500" },

    // Database
    db: { icon: Database, color: "text-blue-600" },
    sqlite: { icon: Database, color: "text-blue-600" },
    sql: { icon: Database, color: "text-blue-600" },
  };

  const fileInfo = iconMap[fileExtension];

  if (fileInfo) {
    const IconComponent = fileInfo.icon;
    return <IconComponent className={`${className} ${fileInfo.color}`} />;
  }

  // Default file icon
  return <File className={`${className} text-gray-400`} />;
}

/**
 * Determine if a file is an EDF file based on its extension
 */
export function isEdfFile(fileName: string): boolean {
  const extension = fileName.split(".").pop()?.toLowerCase();
  return extension === "edf" || extension === "ascii";
}

/**
 * Get file extension from filename
 */
export function getFileExtension(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() || "";
}
