/**
 * Types for the Public Results Gallery feature.
 *
 * The gallery generates a static website from DDA analysis results
 * that can be deployed to GitHub Pages, Netlify, or any static host.
 */

export interface GalleryConfig {
  outputDirectory: string;
  siteTitle: string;
  siteDescription: string;
  author: string;
  baseUrl: string;
  theme: "light" | "dark";
}

export interface GalleryItemMeta {
  analysisId: string;
  title: string;
  description: string;
  author: string;
  tags: string[];
}

export interface GalleryExportResult {
  success: boolean;
  outputPath: string;
  pagesGenerated: number;
  warnings: string[];
}

export interface PublishedGalleryItem {
  id: string;
  analysisId: string;
  title: string;
  description: string | null;
  author: string | null;
  tags: string[];
  outputDirectory: string;
  publishedAt: string;
  updatedAt: string;
}
