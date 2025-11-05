"use client";

import React, { useState } from "react";
import { FiChevronDown, FiChevronRight } from "react-icons/fi";

export type FileTreeNode = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  children?: FileTreeNode[];
  metadata?: any; // For storing file info, BIDS data, etc.
};

export type FileTreeSelection = {
  id: string | null;
  path: string | null;
  node?: FileTreeNode | null;
};

type TreeState = {
  expanded: string[];
  selected: string | null;
};

interface FileTreeInputProps {
  data: FileTreeNode[];
  initialExpandedNodes?: string[];
  onChange?: (selection: FileTreeSelection) => void;
  iconOnOpen?: React.ReactNode;
  iconOnClose?: React.ReactNode;
  childrenIcon?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
}

interface TreeNodeProps {
  node: FileTreeNode;
  state: TreeState;
  onAction: (
    type: "toggle" | "select",
    id: string,
    path?: string,
    node?: FileTreeNode,
  ) => void;
  iconOnOpen?: React.ReactNode;
  iconOnClose?: React.ReactNode;
  childrenIcon?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  parentPath?: string;
  onContextMenu?: (e: React.MouseEvent, node: FileTreeNode) => void;
}

const getSizeClasses = (size: "sm" | "md" | "lg" = "md") => {
  const sizeMap = {
    sm: { padding: "px-2 py-0.5", text: "text-xs", icon: "text-base" },
    md: { padding: "px-3 py-1", text: "text-sm", icon: "text-lg" },
    lg: { padding: "px-4 py-1.5", text: "text-base", icon: "text-xl" },
  };
  return sizeMap[size];
};

const TreeNode: React.FC<TreeNodeProps> = ({
  node,
  state,
  onAction,
  iconOnOpen = <FiChevronDown />,
  iconOnClose = <FiChevronRight />,
  childrenIcon,
  size = "md",
  parentPath = "",
  onContextMenu,
}) => {
  const isExpanded = state.expanded.includes(node.id);
  const isSelected = state.selected === node.id;
  const hasChildren = (node.children || []).length > 0;
  const sizeClasses = getSizeClasses(size);
  const currentPath = parentPath ? `${parentPath}/${node.id}` : node.id;

  return (
    <li>
      <div
        className={`flex items-start hover:*:translate-x-1 *:transition-all m-0.5 select-none gap-2 ${
          sizeClasses.padding
        } rounded-md cursor-pointer hover:bg-gradient-to-r from-secondary to-secondary/10 group border hover:border-secondary ${
          isSelected ? "bg-secondary border-secondary" : "border-border/60"
        }`}
        onClick={() => {
          onAction("toggle", node.id, currentPath, node);
          onAction("select", node.id, currentPath, node);
        }}
        onContextMenu={(e) => {
          if (onContextMenu) {
            e.preventDefault();
            e.stopPropagation();
            onContextMenu(e, node);
          }
        }}
      >
        {hasChildren ? (
          <>
            <span
              className={`flex-shrink-0 transition-colors ${sizeClasses.icon} mt-0.5`}
            >
              {isExpanded ? iconOnOpen : iconOnClose}
            </span>
            {node.icon ? (
              node.icon
            ) : (
              <span className={`${sizeClasses.text} flex-1 truncate`}>
                {node.label}
              </span>
            )}
          </>
        ) : (
          <>
            {node.icon ? (
              node.icon
            ) : (
              <>
                <span className="w-fit flex-shrink-0">{childrenIcon}</span>
                <span className={`${sizeClasses.text} flex-1 truncate`}>
                  {node.label}
                </span>
              </>
            )}
          </>
        )}
      </div>

      {hasChildren && isExpanded && (
        <div className="ml-4 border-l group-hover:border-l-secondary">
          <ul className="space-y-1">
            {node.children?.map((child) => (
              <TreeNode
                key={child.id}
                node={child}
                state={state}
                onAction={onAction}
                iconOnOpen={iconOnOpen}
                iconOnClose={iconOnClose}
                childrenIcon={childrenIcon}
                size={size}
                parentPath={currentPath}
                onContextMenu={onContextMenu}
              />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
};

export const FileTreeInput: React.FC<FileTreeInputProps> = ({
  data,
  initialExpandedNodes = [],
  onChange,
  iconOnOpen,
  iconOnClose,
  childrenIcon,
  size = "md",
  className = "",
}) => {
  const [state, setState] = useState<TreeState>({
    expanded: initialExpandedNodes,
    selected: null,
  });

  const handleAction = (
    type: "toggle" | "select",
    id: string,
    path?: string,
    node?: FileTreeNode,
  ) => {
    setState((prev) => {
      const newState =
        type === "toggle"
          ? {
              ...prev,
              expanded: prev.expanded.includes(id)
                ? prev.expanded.filter((i) => i !== id)
                : [...prev.expanded, id],
            }
          : {
              ...prev,
              selected: id,
            };

      if (type === "select") {
        onChange?.({
          id: newState.selected,
          path: path || null,
          node: node || null,
        });
      }
      return newState;
    });
  };

  return (
    <div
      className={`rounded-xl bg-card p-2 border border-border/50 ${className}`}
    >
      <ul className="space-y-1">
        {data.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            state={state}
            onAction={handleAction}
            iconOnOpen={iconOnOpen}
            iconOnClose={iconOnClose}
            childrenIcon={childrenIcon}
            size={size}
          />
        ))}
      </ul>
    </div>
  );
};

FileTreeInput.displayName = "FileTreeInput";
