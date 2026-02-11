"use client";

import React, {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { FixedSizeList, ListChildComponentProps } from "react-window";
import { FiChevronDown, FiChevronRight } from "react-icons/fi";
import type {
  FileTreeNode,
  FileTreeSelection,
} from "@/components/ui/file-tree-input";
import { VIRTUALIZATION } from "@/lib/constants";

const ROW_HEIGHT = 72;

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
  className = "",
}: VirtualizedFileTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(initialExpandedNodes),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(400);

  useEffect(() => {
    if (initialExpandedNodes.length > 0) {
      setExpandedIds(new Set(initialExpandedNodes));
    }
  }, [initialExpandedNodes]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = Math.floor(entry.contentRect.height);
        if (h > 0) setContainerHeight(h);
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
            className={`flex items-start hover:*:translate-x-1 *:transition-all gap-2 mx-0.5 select-none transition-colors px-3 py-2 rounded-md cursor-pointer hover:bg-gradient-to-r from-secondary to-secondary/10 group border ${
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

  if (flatRows.length < VIRTUALIZATION.THRESHOLD) {
    return (
      <div
        className={`rounded-xl bg-card p-2 border border-border/50 ${className}`}
      >
        <div role="tree" className="space-y-1">
          {flatRows.map((row, index) => (
            <Row
              key={row.node.id}
              index={index}
              style={{}}
              data={undefined}
              isScrolling={false}
            />
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
      {containerHeight > 0 && (
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
      )}
    </div>
  );
}
