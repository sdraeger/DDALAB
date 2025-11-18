"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Settings as SettingsIcon } from "lucide-react";

export interface SettingsSection {
  id: string;
  label: string;
  icon: React.ReactNode;
  component: React.ReactNode;
}

interface SettingsLayoutProps {
  sections: SettingsSection[];
  defaultSection?: string;
}

export function SettingsLayout({
  sections,
  defaultSection,
}: SettingsLayoutProps) {
  const [activeSection, setActiveSection] = useState(
    defaultSection || sections[0]?.id || "",
  );

  const currentSection = sections.find((s) => s.id === activeSection);

  return (
    <div className="flex h-full">
      {/* Sidebar Navigation */}
      <div className="w-64 border-r bg-muted/10">
        <div className="p-6">
          <h2 className="text-lg font-semibold mb-1">Settings</h2>
          <p className="text-sm text-muted-foreground">
            Manage your application preferences
          </p>
        </div>
        <div className="overflow-y-auto h-[calc(100vh-180px)]">
          <nav className="space-y-1 px-3 pb-4">
            {sections.map((section) => (
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
            ))}
          </nav>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto">
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
