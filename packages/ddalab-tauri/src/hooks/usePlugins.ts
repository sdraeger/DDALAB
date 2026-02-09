"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { tauriBackendService } from "@/services/tauriBackendService";
import type {
  InstalledPluginResponse,
  PluginOutputResponse,
  PluginRegistryIndexResponse,
} from "@/services/tauriBackendService";

export const pluginKeys = {
  all: ["plugins"] as const,
  installed: () => [...pluginKeys.all, "installed"] as const,
  detail: (pluginId: string) =>
    [...pluginKeys.all, "detail", pluginId] as const,
  registry: (url: string) => [...pluginKeys.all, "registry", url] as const,
};

export function useInstalledPlugins() {
  return useQuery({
    queryKey: pluginKeys.installed(),
    queryFn: () => tauriBackendService.listInstalledPlugins(),
    staleTime: 30_000,
  });
}

export function useInstalledPlugin(pluginId: string | null) {
  return useQuery({
    queryKey: pluginKeys.detail(pluginId ?? ""),
    queryFn: () => tauriBackendService.getInstalledPlugin(pluginId!),
    enabled: !!pluginId,
    staleTime: 60_000,
  });
}

export function usePluginRegistry(registryUrl: string | null) {
  return useQuery({
    queryKey: pluginKeys.registry(registryUrl ?? ""),
    queryFn: () => tauriBackendService.fetchPluginRegistry(registryUrl!),
    enabled: !!registryUrl,
    staleTime: 5 * 60_000,
  });
}

export function useInstallPlugin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      registryUrl,
      pluginId,
    }: {
      registryUrl: string;
      pluginId: string;
    }) => tauriBackendService.installPluginFromRegistry(registryUrl, pluginId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pluginKeys.installed() });
    },
  });
}

export function useUninstallPlugin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (pluginId: string) =>
      tauriBackendService.uninstallPlugin(pluginId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pluginKeys.installed() });
    },
  });
}

export function useTogglePlugin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      pluginId,
      enabled,
    }: {
      pluginId: string;
      enabled: boolean;
    }) => tauriBackendService.togglePlugin(pluginId, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pluginKeys.installed() });
    },
  });
}

export function useRunPlugin() {
  return useMutation({
    mutationFn: ({
      pluginId,
      analysisId,
    }: {
      pluginId: string;
      analysisId: string;
    }) => tauriBackendService.runPlugin(pluginId, analysisId),
  });
}

export type {
  InstalledPluginResponse,
  PluginOutputResponse,
  PluginRegistryIndexResponse,
};
