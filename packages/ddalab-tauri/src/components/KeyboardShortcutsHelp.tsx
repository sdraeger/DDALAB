"use client";

import { useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import {
  useKeyboardShortcutsStore,
  type KeyboardShortcut,
  type ShortcutGroup,
} from "@/store/keyboardShortcutsStore";
import { Search, Keyboard, Command } from "lucide-react";
import { cn } from "@/lib/utils";

// Category icons and colors
const categoryStyles: Record<string, { color: string; bgColor: string }> = {
  Navigation: { color: "text-blue-600", bgColor: "bg-blue-500/10" },
  Files: { color: "text-green-600", bgColor: "bg-green-500/10" },
  Analysis: { color: "text-orange-600", bgColor: "bg-orange-500/10" },
  Edit: { color: "text-purple-600", bgColor: "bg-purple-500/10" },
  View: { color: "text-cyan-600", bgColor: "bg-cyan-500/10" },
  Help: { color: "text-pink-600", bgColor: "bg-pink-500/10" },
  global: { color: "text-gray-600", bgColor: "bg-gray-500/10" },
};

function ShortcutKey({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 text-xs font-semibold bg-muted border border-border rounded shadow-sm">
      {children}
    </kbd>
  );
}

function ShortcutDisplay({ shortcut }: { shortcut: KeyboardShortcut }) {
  const formatShortcut = useKeyboardShortcutsStore((s) => s.formatShortcut);
  const formatted = formatShortcut(shortcut);

  // Split the formatted string and render each part
  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toLowerCase().includes("mac");

  // Parse and render individual keys
  const parts = isMac ? formatted.split("") : formatted.split("+");

  return (
    <div className="flex items-center gap-0.5">
      {parts.map((part, i) => (
        <ShortcutKey key={i}>{part}</ShortcutKey>
      ))}
    </div>
  );
}

function ShortcutRow({
  shortcut,
  isHighlighted,
}: {
  shortcut: KeyboardShortcut;
  isHighlighted: boolean;
}) {
  const style =
    categoryStyles[shortcut.category || "global"] || categoryStyles.global;

  return (
    <div
      className={cn(
        "flex items-center justify-between py-2 px-3 rounded-lg transition-colors",
        isHighlighted && "bg-accent",
        "hover:bg-accent/50",
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{shortcut.label}</span>
          {shortcut.context !== "global" && (
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] px-1.5 py-0",
                style.color,
                style.bgColor,
              )}
            >
              {shortcut.context}
            </Badge>
          )}
        </div>
        {shortcut.description && (
          <p className="text-xs text-muted-foreground truncate">
            {shortcut.description}
          </p>
        )}
      </div>
      <ShortcutDisplay shortcut={shortcut} />
    </div>
  );
}

function ShortcutGroupSection({
  group,
  searchQuery,
}: {
  group: ShortcutGroup;
  searchQuery: string;
}) {
  const style = categoryStyles[group.name] || categoryStyles.global;

  // Filter shortcuts by search query
  const filteredShortcuts = searchQuery
    ? group.shortcuts.filter(
        (s) =>
          s.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.description.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : group.shortcuts;

  if (filteredShortcuts.length === 0) return null;

  return (
    <div className="space-y-1">
      <h3
        className={cn(
          "text-xs font-semibold uppercase tracking-wider px-3 py-1.5",
          style.color,
        )}
      >
        {group.name}
      </h3>
      <div className="space-y-0.5">
        {filteredShortcuts.map((shortcut) => (
          <ShortcutRow
            key={shortcut.id}
            shortcut={shortcut}
            isHighlighted={
              searchQuery.length > 0 &&
              shortcut.label.toLowerCase().startsWith(searchQuery.toLowerCase())
            }
          />
        ))}
      </div>
    </div>
  );
}

export function KeyboardShortcutsHelp() {
  const isHelpOpen = useKeyboardShortcutsStore((s) => s.isHelpOpen);
  const setHelpOpen = useKeyboardShortcutsStore((s) => s.setHelpOpen);
  const getGroupedShortcuts = useKeyboardShortcutsStore(
    (s) => s.getGroupedShortcuts,
  );

  const [searchQuery, setSearchQuery] = useState("");
  const groups = getGroupedShortcuts();

  // Reset search when dialog closes
  useEffect(() => {
    if (!isHelpOpen) {
      setSearchQuery("");
    }
  }, [isHelpOpen]);

  // Count total shortcuts and filtered
  const totalShortcuts = groups.reduce((acc, g) => acc + g.shortcuts.length, 0);
  const filteredCount = searchQuery
    ? groups.reduce(
        (acc, g) =>
          acc +
          g.shortcuts.filter(
            (s) =>
              s.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
              s.description.toLowerCase().includes(searchQuery.toLowerCase()),
          ).length,
        0,
      )
    : totalShortcuts;

  return (
    <Dialog open={isHelpOpen} onOpenChange={setHelpOpen}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Keyboard className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-xl">Keyboard Shortcuts</DialogTitle>
              <p className="text-sm text-muted-foreground">
                {totalShortcuts} shortcuts available
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Search */}
        <div className="px-6 py-3 border-b bg-muted/30">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search shortcuts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-background"
              autoFocus
            />
          </div>
          {searchQuery && (
            <p className="text-xs text-muted-foreground mt-2">
              Showing {filteredCount} of {totalShortcuts} shortcuts
            </p>
          )}
        </div>

        {/* Shortcuts list */}
        <ScrollArea className="flex-1 px-6 py-4">
          {filteredCount === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">
                No shortcuts match "{searchQuery}"
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {groups.map((group) => (
                <ShortcutGroupSection
                  key={group.name}
                  group={group}
                  searchQuery={searchQuery}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="px-6 py-3 border-t bg-muted/30 flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              Press{" "}
              <ShortcutKey>
                <Command className="h-3 w-3" />
              </ShortcutKey>
              <ShortcutKey>K</ShortcutKey> for search
            </span>
          </div>
          <span className="flex items-center gap-1">
            Press <ShortcutKey>?</ShortcutKey> to toggle this overlay
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
