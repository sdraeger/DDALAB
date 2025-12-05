"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useScrollTrap } from "@/hooks/useScrollTrap";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Settings as SettingsIcon, Search, X } from "lucide-react";

export interface SettingsSection {
  id: string;
  label: string;
  icon: React.ReactNode;
  component: React.ReactNode;
  keywords?: string[]; // Optional keywords for better search matching
  description?: string; // Optional description for search
}

interface SettingsLayoutProps {
  sections: SettingsSection[];
  defaultSection?: string;
}

// Simple fuzzy match for settings search
function fuzzyMatch(text: string, query: string): boolean {
  const lower = text.toLowerCase();
  const queryLower = query.toLowerCase();

  // Direct inclusion
  if (lower.includes(queryLower)) return true;

  // Simple token matching
  const queryTokens = queryLower.split(/\s+/).filter(Boolean);
  return queryTokens.every((token) => lower.includes(token));
}

export function SettingsLayout({
  sections,
  defaultSection,
}: SettingsLayoutProps) {
  const [activeSection, setActiveSection] = useState(
    defaultSection || sections[0]?.id || "",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Scroll traps for sidebar and content areas
  const {
    containerProps: sidebarScrollProps,
    isScrollEnabled: isSidebarScrollEnabled,
  } = useScrollTrap({ activationDelay: 100 });
  const {
    containerProps: contentScrollProps,
    isScrollEnabled: isContentScrollEnabled,
  } = useScrollTrap({ activationDelay: 100 });

  // Filter sections based on search
  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return sections;

    return sections.filter((section) => {
      // Match against label
      if (fuzzyMatch(section.label, searchQuery)) return true;

      // Match against description
      if (section.description && fuzzyMatch(section.description, searchQuery)) {
        return true;
      }

      // Match against keywords
      if (section.keywords?.some((kw) => fuzzyMatch(kw, searchQuery))) {
        return true;
      }

      return false;
    });
  }, [sections, searchQuery]);

  // Auto-select first matching section when search changes
  useEffect(() => {
    if (searchQuery.trim() && filteredSections.length > 0) {
      // Only auto-select if current selection is not in filtered results
      if (!filteredSections.find((s) => s.id === activeSection)) {
        setActiveSection(filteredSections[0].id);
      }
    }
  }, [filteredSections, searchQuery, activeSection]);

  // Keyboard shortcut to focus search (Cmd+F when in settings)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      // Escape clears search
      if (e.key === "Escape" && searchQuery) {
        setSearchQuery("");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [searchQuery]);

  const currentSection = sections.find((s) => s.id === activeSection);

  const handleClearSearch = () => {
    setSearchQuery("");
    searchInputRef.current?.focus();
  };

  return (
    <div className="flex h-full">
      {/* Sidebar Navigation */}
      <div className="w-64 border-r bg-muted/10 flex flex-col">
        <div className="p-6 pb-3">
          <h2 className="text-lg font-semibold mb-1">Settings</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Manage your application preferences
          </p>

          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              type="text"
              placeholder="Search settings..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-8 h-9 text-sm"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
                onClick={handleClearSearch}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>

        <div
          ref={sidebarScrollProps.ref}
          onMouseEnter={sidebarScrollProps.onMouseEnter}
          onMouseLeave={sidebarScrollProps.onMouseLeave}
          className={`flex-1 ${isSidebarScrollEnabled ? "overflow-y-auto" : "overflow-hidden"}`}
          style={sidebarScrollProps.style}
        >
          <nav className="space-y-1 px-3 pb-4">
            {filteredSections.length > 0 ? (
              filteredSections.map((section) => (
                <Button
                  key={section.id}
                  variant={activeSection === section.id ? "secondary" : "ghost"}
                  className={cn(
                    "w-full justify-start gap-3",
                    activeSection === section.id && "bg-secondary",
                  )}
                  onClick={() => setActiveSection(section.id)}
                >
                  {section.icon}
                  {section.label}
                </Button>
              ))
            ) : (
              <div className="py-4 text-center text-sm text-muted-foreground">
                <p>No matching settings</p>
                <Button
                  variant="link"
                  size="sm"
                  className="text-xs mt-1"
                  onClick={handleClearSearch}
                >
                  Clear search
                </Button>
              </div>
            )}
          </nav>
        </div>

        {/* Keyboard hint */}
        <div className="px-4 py-2 border-t text-[10px] text-muted-foreground flex items-center justify-center gap-1">
          <kbd className="px-1 py-0.5 rounded bg-muted border">⌘F</kbd>
          <span>to search</span>
        </div>
      </div>

      {/* Content Area */}
      <div
        ref={contentScrollProps.ref}
        onMouseEnter={contentScrollProps.onMouseEnter}
        onMouseLeave={contentScrollProps.onMouseLeave}
        className={`flex-1 ${isContentScrollEnabled ? "overflow-y-auto" : "overflow-hidden"}`}
        style={contentScrollProps.style}
      >
        {currentSection ? (
          <div id={`settings-section-${currentSection.id}`} className="p-6">
            {currentSection.component}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-muted-foreground">
              <SettingsIcon className="h-16 w-16 mx-auto mb-4 opacity-20" />
              <p>Select a settings section</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
