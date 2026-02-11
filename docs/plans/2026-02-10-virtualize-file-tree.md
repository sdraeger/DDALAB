# Virtualize File Tree Sidebar

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the recursive `FileTreeInput` component with a virtualized flat-list tree so the file sidebar stays responsive with large BIDS datasets (hundreds of subjects/sessions).

**Architecture:** Flatten the expanded tree into a single array of `FlatRow` objects (each carrying depth, expand state, original node ref), then render with `react-window` `FixedSizeList`. Expand/collapse mutates the `expandedIds` set and recomputes the flat array. The existing `FileTreeRenderer` continues to own tree data, lazy loading, and search — only the rendering layer changes.

**Tech Stack:** `react-window` (already installed), existing `FileTreeNode` type from `ui/file-tree-input.tsx`.

---

### Task 1: Create `VirtualizedFileTree` component

**Files:**
- Create: `src/components/file-manager/VirtualizedFileTree.tsx`

**Step 1: Write the component**

This is a new component that replaces `FileTreeInput` inside `FileTreeRenderer`. It takes the same `FileTreeNode[]` data, flattens visible (expanded) nodes into a list, and renders with `FixedSizeList`.

```tsx
"use client";

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { FixedSizeList, ListChildComponentProps } from "react-window";
import { FiChevronDown, FiChevronRight } from "react-icons/fi";
import type { FileTreeNode, FileTreeSelection } from "@/components/ui/file-tree-input";
import { VIRTUALIZATION } from "@/lib/constants";

const ROW_HEIGHT = 40;

interface FlatRow {
  node: FileTreeNode;
  depth: number;
  isExpanded: boolean;
  isExpandable: boolean;
}

interface VirtualizedFileTreeProps {
  data: FileTreeNode[];
  initialExpandedNodes?: string[];
  onChange?: (selection: FileTreeSelection) => void;
  size?: "sm" | "md" | "lg";
  className?: string;
}

function flattenTree(
  nodes: FileTreeNode[],
  expandedIds: Set<string>,
  depth: number = 0,
): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const node of nodes) {
    const isExpandable = node.children !== undefined;
    const isExpanded = expandedIds.has(node.id);
    rows.push({ node, depth, isExpanded, isExpandable });
    if (isExpandable && isExpanded && node.children) {
      rows.push(...flattenTree(node.children, expandedIds, depth + 1));
    }
  }
  return rows;
}

export function VirtualizedFileTree({
  data,
  initialExpandedNodes = [],
  onChange,
  size = "md",
  className = "",
}: VirtualizedFileTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(initialExpandedNodes),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(400);

  // Sync initialExpandedNodes when they change (e.g. search changes)
  useEffect(() => {
    if (initialExpandedNodes.length > 0) {
      setExpandedIds(new Set(initialExpandedNodes));
    }
  }, [initialExpandedNodes]);

  // Measure container height
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(Math.floor(entry.contentRect.height));
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const flatRows = useMemo(
    () => flattenTree(data, expandedIds),
    [data, expandedIds],
  );

  const handleToggle = useCallback((nodeId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (node: FileTreeNode) => {
      setSelectedId(node.id);
      // Toggle expand on click for expandable nodes
      if (node.children !== undefined) {
        handleToggle(node.id);
      }
      onChange?.({ id: node.id, path: node.id, node });
    },
    [onChange, handleToggle],
  );

  const Row = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const row = flatRows[index];
      const { node, depth, isExpanded, isExpandable } = row;
      const isSelected = selectedId === node.id;

      return (
        <div style={style}>
          <div
            className={`flex items-start gap-2 mx-0.5 select-none transition-colors px-3 py-1 rounded-md cursor-pointer hover:bg-gradient-to-r from-secondary to-secondary/10 border ${
              isSelected
                ? "bg-secondary border-secondary"
                : "border-border/60 hover:border-secondary"
            }`}
            style={{ paddingLeft: `${depth * 16 + 12}px` }}
            onClick={() => handleSelect(node)}
            role="treeitem"
            aria-expanded={isExpandable ? isExpanded : undefined}
            aria-selected={isSelected}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleSelect(node);
              }
            }}
          >
            {isExpandable && (
              <span className="flex-shrink-0 text-lg mt-0.5">
                {isExpanded ? <FiChevronDown /> : <FiChevronRight />}
              </span>
            )}
            {node.icon ? (
              node.icon
            ) : (
              <span className="text-sm flex-1 truncate">{node.label}</span>
            )}
          </div>
        </div>
      );
    },
    [flatRows, selectedId, handleSelect],
  );

  // For small trees, render without virtualization
  if (flatRows.length < VIRTUALIZATION.THRESHOLD) {
    return (
      <div className={`rounded-xl bg-card p-2 border border-border/50 ${className}`}>
        <div role="tree">
          {flatRows.map((row, index) => (
            <Row key={row.node.id} index={index} style={{}} data={undefined} isScrolling={false} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`rounded-xl bg-card border border-border/50 flex-1 min-h-0 ${className}`}
      role="tree"
    >
      <FixedSizeList
        height={containerHeight}
        width="100%"
        itemCount={flatRows.length}
        itemSize={ROW_HEIGHT}
        overscanCount={VIRTUALIZATION.OVERSCAN_COUNT}
        className="scrollbar-thin p-2"
        itemKey={(index) => flatRows[index].node.id}
      >
        {Row}
      </FixedSizeList>
    </div>
  );
}
```

**Step 2: Verify it compiles**

Run: `cd packages/ddalab-tauri && bun run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/file-manager/VirtualizedFileTree.tsx
git commit -m "feat(file-manager): add VirtualizedFileTree component"
```

---

### Task 2: Wire `VirtualizedFileTree` into `FileTreeRenderer`

**Files:**
- Modify: `src/components/file-manager/FileTreeRenderer.tsx` — replace `FileTreeInput` with `VirtualizedFileTree`
- Modify: `src/components/file-manager/index.ts` — export new component

**Step 1: Update FileTreeRenderer**

In `FileTreeRenderer.tsx`, replace the `FileTreeInput` import and usage:

1. Replace import:
```tsx
// Remove:
import { FileTreeInput, type FileTreeNode, type FileTreeSelection } from "@/components/ui/file-tree-input";

// Add:
import type { FileTreeNode, FileTreeSelection } from "@/components/ui/file-tree-input";
import { VirtualizedFileTree } from "./VirtualizedFileTree";
```

2. Replace the JSX at the bottom of the component (line ~812-821). Change:
```tsx
<FileTreeInput
  data={treeData}
  onChange={handleSelection}
  size="md"
  className="border-0 bg-transparent p-0"
  initialExpandedNodes={initialExpandedNodes}
  key={searchQuery}
/>
```
To:
```tsx
<VirtualizedFileTree
  data={treeData}
  onChange={handleSelection}
  size="md"
  className="border-0 bg-transparent p-0"
  initialExpandedNodes={initialExpandedNodes}
  key={searchQuery}
/>
```

**Step 2: Update exports in `index.ts`**

Add to `src/components/file-manager/index.ts`:
```ts
export { VirtualizedFileTree } from "./VirtualizedFileTree";
```

**Step 3: Verify it compiles**

Run: `cd packages/ddalab-tauri && bun run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add src/components/file-manager/FileTreeRenderer.tsx src/components/file-manager/index.ts
git commit -m "feat(file-manager): wire VirtualizedFileTree into FileTreeRenderer"
```

---

### Task 3: Ensure the sidebar container propagates height

**Files:**
- Modify: `src/components/FileManager.tsx` — ensure the `CardContent` wrapping the tree has a measurable height for `react-window`

**Step 1: Check and fix container height**

The `VirtualizedFileTree` uses a `ResizeObserver` to measure its container. The parent `CardContent` must have a bounded height (not just `overflow-y-auto` with unbounded content). Look at the `CardContent` that wraps `FileTreeRenderer` and ensure it has `flex-1 min-h-0` so it takes remaining sidebar space without overflowing.

Find the `<CardContent>` that wraps the tree (around line ~1180-1247 of FileManager.tsx). Ensure its parent flex container gives it bounded height. The `VirtualizedFileTree` needs `flex-1 min-h-0` on its container to measure correctly.

**Step 2: Verify it compiles**

Run: `cd packages/ddalab-tauri && bun run typecheck`
Expected: No errors

**Step 3: Format**

Run: `cd packages/ddalab-tauri && bun run fmt`

**Step 4: Commit**

```bash
git add src/components/FileManager.tsx
git commit -m "fix(file-manager): ensure sidebar container propagates height for virtualization"
```

---

### Task 4: Adjust row height for file nodes with metadata

**Files:**
- Modify: `src/components/file-manager/VirtualizedFileTree.tsx`

**Step 1: Handle variable content**

File nodes have taller content than directory nodes (they include badges, metadata). The `FileTreeRenderer` already renders full file info inside `node.icon` as JSX. Since `FixedSizeList` requires uniform height, use a generous `ROW_HEIGHT` that accommodates the tallest row (file with BIDS metadata badges). Set `ROW_HEIGHT = 72` to match the existing `VirtualizedFileList` ITEM_HEIGHT, which was already designed for file rows with badges.

Alternatively, if most rows are directories (smaller), use `VariableSizeList` with a `getItemSize` callback that returns 40 for directories and 72 for files. This is more complex but wastes less space.

**Recommended approach:** Use `ROW_HEIGHT = 72` for simplicity. Directory rows will have some extra padding but this is visually fine and avoids the complexity of variable-size measurement.

**Step 2: Verify it compiles and format**

Run: `cd packages/ddalab-tauri && bun run typecheck && bun run fmt`

**Step 3: Commit**

```bash
git add src/components/file-manager/VirtualizedFileTree.tsx
git commit -m "fix(file-manager): set row height to accommodate file metadata badges"
```

---

### Task 5: Manual testing checklist

Test the following scenarios in `bun run tauri:dev`:

1. **Small directory (<50 items):** Renders without virtualization (same as before)
2. **Large directory (50+ items):** Renders with FixedSizeList, smooth scrolling
3. **Expand/collapse directory:** Updates flat list, scrolls smoothly
4. **File selection:** Clicking a file selects it and calls `onFileSelect`
5. **Directory lazy loading:** Expanding a directory triggers `loadDirectoryContents` on first expand
6. **BIDS dataset:** Expanding a BIDS root loads subjects, further expand loads sessions/runs
7. **Search:** Typing in search filters tree and auto-expands matching paths
8. **Search → virtualized flat list:** With 50+ flat results and no directories, still uses `VirtualizedFileList`
9. **Context menu:** Right-click on files shows context menu
10. **Keyboard:** Shift+F10 on focused file opens context menu

---

## Files Modified

| File | Action |
|------|--------|
| `src/components/file-manager/VirtualizedFileTree.tsx` | **NEW** — virtualized tree renderer |
| `src/components/file-manager/FileTreeRenderer.tsx` | Replace `FileTreeInput` with `VirtualizedFileTree` |
| `src/components/file-manager/index.ts` | Export new component |
| `src/components/FileManager.tsx` | Ensure container height propagates |

## Verification

```bash
cd packages/ddalab-tauri
bun run typecheck
bun run fmt
```
