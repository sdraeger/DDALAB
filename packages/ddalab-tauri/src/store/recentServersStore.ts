import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { persist } from "zustand/middleware";

export interface RecentServer {
  url: string;
  name: string;
  institution: string;
  lastConnected: number; // Unix timestamp
  connectionCount: number;
  userEmail?: string; // Saved for convenience (not password)
  version?: string;
}

interface RecentServersState {
  // Recent servers (ordered by last connection)
  recentServers: RecentServer[];
  maxRecentServers: number;

  // Actions
  addRecentServer: (
    server: Omit<RecentServer, "lastConnected" | "connectionCount">,
  ) => void;
  removeRecentServer: (url: string) => void;
  clearRecentServers: () => void;
  updateServerEmail: (url: string, email: string) => void;
  getServerByUrl: (url: string) => RecentServer | undefined;
}

// Helper to get relative time
export function getRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "Just now";
}

export const useRecentServersStore = create<RecentServersState>()(
  persist(
    immer((set, get) => ({
      recentServers: [],
      maxRecentServers: 10,

      addRecentServer: (server) => {
        set((state) => {
          const existingIndex = state.recentServers.findIndex(
            (s) => s.url === server.url,
          );

          if (existingIndex >= 0) {
            // Update existing entry
            state.recentServers[existingIndex].lastConnected = Date.now();
            state.recentServers[existingIndex].connectionCount += 1;
            state.recentServers[existingIndex].name = server.name;
            state.recentServers[existingIndex].institution = server.institution;
            if (server.userEmail) {
              state.recentServers[existingIndex].userEmail = server.userEmail;
            }
            if (server.version) {
              state.recentServers[existingIndex].version = server.version;
            }
            // Move to front
            const [item] = state.recentServers.splice(existingIndex, 1);
            state.recentServers.unshift(item);
          } else {
            // Add new entry
            state.recentServers.unshift({
              ...server,
              lastConnected: Date.now(),
              connectionCount: 1,
            });
            // Trim to max
            if (state.recentServers.length > state.maxRecentServers) {
              state.recentServers = state.recentServers.slice(
                0,
                state.maxRecentServers,
              );
            }
          }
        });
      },

      removeRecentServer: (url) => {
        set((state) => {
          state.recentServers = state.recentServers.filter(
            (s) => s.url !== url,
          );
        });
      },

      clearRecentServers: () => {
        set((state) => {
          state.recentServers = [];
        });
      },

      updateServerEmail: (url, email) => {
        set((state) => {
          const server = state.recentServers.find((s) => s.url === url);
          if (server) {
            server.userEmail = email;
          }
        });
      },

      getServerByUrl: (url) => {
        return get().recentServers.find((s) => s.url === url);
      },
    })),
    {
      name: "ddalab-recent-servers",
    },
  ),
);
