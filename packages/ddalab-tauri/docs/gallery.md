# Public Results Gallery

Generate a deployable static website from DDA analysis results. Each result gets its own HTML page with an interactive heatmap, summary tables, and full parameter metadata. A gallery index page lists all published results with search/filter and thumbnail previews.

The generated site works with **zero external dependencies** — no Tauri, no WASM, no backend server. Just self-contained HTML/CSS/JS with inlined data. Deploy to GitHub Pages, Netlify, S3, or any static host.

## Quick Start

1. Navigate to **Collaborate > Gallery** in the sidebar
2. Select one or more completed DDA analyses from the list
3. Click **New Export** (or **Export Selected**)
4. Choose an output directory, fill in metadata (title, description, tags per item)
5. Click **Export Gallery**
6. Open the generated `index.html` in any browser

Alternatively, use the **Gallery** button in the Export toolbar on any DDA result page to publish a single analysis directly.

## Architecture

### Data Flow

```
DDA Analysis Result (in SQLite)
        │
        ▼
 serialize_for_gallery()      ← Rust: decimates matrix, computes color range
        │
        ▼
 GalleryGenerator::generate() ← Rust: renders HTML templates with inlined data
        │
        ▼
 Static HTML/CSS/JS files     ← Self-contained, no external dependencies
        │
        ▼
 Any static host              ← GitHub Pages, Netlify, S3, local file://
```

### File Structure

#### Rust Backend

| File                                         | Purpose                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src-tauri/src/gallery/mod.rs`               | Module root                                                                                 |
| `src-tauri/src/gallery/data_transform.rs`    | Matrix decimation, thumbnail generation, color range computation, `serialize_for_gallery()` |
| `src-tauri/src/gallery/templates.rs`         | Embeds HTML/CSS/JS templates via `include_str!()`, card/tag rendering helpers               |
| `src-tauri/src/gallery/generator.rs`         | `GalleryGenerator` — renders result pages and index, writes output directory                |
| `src-tauri/src/db/gallery_db.rs`             | `GalleryDB` CRUD for tracking published items in SQLite                                     |
| `src-tauri/src/db/migrations.rs`             | `AddGalleryTable` migration (version `20260209000001`)                                      |
| `src-tauri/src/commands/gallery_commands.rs` | 5 Tauri IPC commands                                                                        |

#### HTML/CSS/JS Templates

| File                                      | Purpose                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| `src-tauri/gallery_templates/index.html`  | Gallery index page with search, sort, and card grid                    |
| `src-tauri/gallery_templates/result.html` | Individual result page with heatmap, tables, parameters                |
| `src-tauri/gallery_templates/gallery.css` | Shared styles with light/dark theme support (~5 KB)                    |
| `src-tauri/gallery_templates/gallery.js`  | Canvas2D heatmap renderer, viridis colormap, search/sort logic (~8 KB) |

#### Frontend

| File                                                | Purpose                                                                                                         |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/types/gallery.ts`                              | TypeScript type definitions (`GalleryConfig`, `GalleryItemMeta`, `GalleryExportResult`, `PublishedGalleryItem`) |
| `src/store/slices/gallerySlice.ts`                  | Zustand+Immer state slice for gallery config, selections, and export state                                      |
| `src/services/tauriBackendService.ts`               | Service methods + response types for gallery IPC                                                                |
| `src/hooks/useGallery.ts`                           | TanStack Query hooks (`useGalleryItems`, `useExportGallery`, `useRemoveGalleryItem`)                            |
| `src/components/gallery/GalleryManagementPanel.tsx` | Main panel: analysis selection checkboxes, published items list, config toggle                                  |
| `src/components/gallery/GalleryConfigForm.tsx`      | Config form: output directory picker, site title, author, theme                                                 |
| `src/components/gallery/GalleryItemCard.tsx`        | Published item card with Open Folder / Remove actions                                                           |
| `src/components/gallery/PublishToGalleryDialog.tsx` | Export dialog: per-item metadata entry, progress bar, success/error states                                      |
| `src/components/dda/ExportMenu.tsx`                 | "Gallery" button added to the DDA export toolbar                                                                |

### Navigation

Gallery is a secondary tab under **Collaborate** in the primary navigation:

- Primary: `collaborate`
- Secondary: `gallery`
- Default: gallery is the default secondary tab when Collaborate is selected

## Tauri IPC Commands

| Command                    | Parameters                                                    | Returns                                 |
| -------------------------- | ------------------------------------------------------------- | --------------------------------------- |
| `select_gallery_directory` | —                                                             | `Option<String>` (folder picker dialog) |
| `export_gallery`           | `analysis_ids`, `config`, `item_metadata`, `output_directory` | `GalleryExportResult`                   |
| `list_gallery_items`       | —                                                             | `Vec<GalleryItem>`                      |
| `remove_gallery_item`      | `item_id`                                                     | `bool`                                  |
| `open_gallery_directory`   | `directory`                                                   | — (opens in OS file manager)            |

## Database Schema

```sql
CREATE TABLE gallery_items (
    id TEXT PRIMARY KEY,
    analysis_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    author TEXT,
    tags TEXT NOT NULL DEFAULT '[]',        -- JSON array of strings
    output_directory TEXT NOT NULL,
    published_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_gallery_analysis_id ON gallery_items(analysis_id);
```

## Generated Site Structure

```
output_directory/
├── index.html              ← Gallery index with search/sort/card grid
├── {analysis-slug-1}.html  ← Full result page with interactive heatmap
├── {analysis-slug-2}.html
└── ...
```

All CSS and JS are inlined in each HTML file — no external asset requests, no CORS issues, works from `file://`.

### Result Page Features

- **Interactive heatmap** — Canvas2D with viridis colormap, hover tooltip showing channel/window/value
- **Color legend** — Auto-scaled 2nd/98th percentile range
- **Exponents table** — Channel-level DDA exponent values
- **Quality metrics table** — Channel-level quality scores
- **Parameters section** — Full analysis configuration (window length, step, delays, variant)
- **Metadata** — Title, description, author, tags, date, file name, variant

### Index Page Features

- **Card grid** — Thumbnail heatmap preview (50x10 decimated), title, variant badge, channel count, date
- **Search** — Filter by title, variant, channels, or tags
- **Sort** — Newest first, oldest first, name A-Z, name Z-A
- **Responsive** — Works on mobile and desktop

## Data Decimation

Large DDA matrices (thousands of windows) are decimated for the gallery to keep HTML file sizes reasonable:

- **Full heatmap**: stride-sampled to max 500 columns
- **Thumbnail**: 50 columns x 10 rows for index card previews
- **Color range**: 2nd/98th percentile for robust auto-scaling (ignores NaN/Inf)

The original analysis data in the database is never modified.

## Theming

The gallery supports `light` and `dark` themes via the `data-theme` attribute on `<html>`. Theme is set at export time in the gallery config and cannot be toggled by the viewer (keeps the site dependency-free).

## Testing

```bash
# Rust unit tests (data transforms, slug generation)
cd packages/ddalab-tauri/src-tauri
cargo test --lib gallery

# TypeScript type checking
cd packages/ddalab-tauri
bun run typecheck
```
