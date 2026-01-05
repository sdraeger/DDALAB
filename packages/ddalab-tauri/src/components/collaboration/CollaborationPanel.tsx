/**
 * CollaborationPanel - Main entry point for collaboration features
 *
 * Provides tabbed interface for:
 * - Team Management
 * - Shared With Me
 * - My Shares
 * - Federation Settings (admin only)
 */
import { useState } from "react";
import { Users, Inbox, Share2, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { TeamManagement } from "./TeamManagement";
import { SharedWithMe } from "./SharedWithMe";
import { MyShares } from "./MyShares";
import { FederationSettings } from "./FederationSettings";
import { useInstitutionConfig } from "@/hooks/useInstitutionConfig";

type CollaborationTab = "teams" | "shared-with-me" | "my-shares" | "federation";

interface TabItem {
  id: CollaborationTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export function CollaborationPanel() {
  const [activeTab, setActiveTab] = useState<CollaborationTab>("teams");
  const { config } = useInstitutionConfig();

  const institutionId = config?.id ?? "default";
  const institutionName = config?.name ?? "My Institution";
  const showFederation = config?.allow_federation ?? false;

  const tabs: TabItem[] = [
    { id: "teams", label: "Teams", icon: Users },
    { id: "shared-with-me", label: "Inbox", icon: Inbox },
    { id: "my-shares", label: "My Shares", icon: Share2 },
    ...(showFederation
      ? [{ id: "federation" as const, label: "Federation", icon: Building2 }]
      : []),
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 pt-6 pb-4">
        <h2 className="text-2xl font-semibold tracking-tight">Collaboration</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Share results and collaborate with your team
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="px-6 border-b">
        <nav
          className="flex gap-1"
          role="tablist"
          aria-label="Collaboration sections"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                aria-controls={`panel-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "group relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors",
                  "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-t-md",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground/80",
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 transition-colors",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground group-hover:text-foreground/80",
                  )}
                />
                <span>{tab.label}</span>

                {/* Active indicator line */}
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-auto">
        <div
          id="panel-teams"
          role="tabpanel"
          aria-labelledby="tab-teams"
          className={cn("h-full p-6", activeTab !== "teams" && "hidden")}
        >
          <TeamManagement institutionId={institutionId} />
        </div>

        <div
          id="panel-shared-with-me"
          role="tabpanel"
          aria-labelledby="tab-shared-with-me"
          className={cn(
            "h-full p-6",
            activeTab !== "shared-with-me" && "hidden",
          )}
        >
          <SharedWithMe />
        </div>

        <div
          id="panel-my-shares"
          role="tabpanel"
          aria-labelledby="tab-my-shares"
          className={cn("h-full p-6", activeTab !== "my-shares" && "hidden")}
        >
          <MyShares />
        </div>

        {showFederation && (
          <div
            id="panel-federation"
            role="tabpanel"
            aria-labelledby="tab-federation"
            className={cn("h-full p-6", activeTab !== "federation" && "hidden")}
          >
            <FederationSettings
              institutionId={institutionId}
              institutionName={institutionName}
            />
          </div>
        )}
      </div>
    </div>
  );
}
