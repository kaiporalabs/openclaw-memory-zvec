import type { OpenClawConfig } from "openclaw/plugin-sdk/config-types";
import {
  resolveMemoryDeepDreamingConfig,
  resolveMemoryDreamingConfig,
  resolveMemoryDreamingPluginConfig,
} from "openclaw/plugin-sdk/memory-core-host-status";

export type ZvecDreamingRuntimeConfig = {
  enabled: boolean;
  cron: string;
  timezone?: string;
  limit: number;
  maxAgeDays?: number;
  recencyHalfLifeDays: number;
  verboseLogging: boolean;
  storageMode: "inline" | "separate" | "both";
  separateReports: boolean;
};

export function resolveZvecDreamingRuntimeConfig(params: {
  cfg: OpenClawConfig;
}): ZvecDreamingRuntimeConfig {
  const pluginConfig = resolveMemoryDreamingPluginConfig(params.cfg);
  const dreaming = resolveMemoryDreamingConfig({ pluginConfig, cfg: params.cfg });
  const deep = resolveMemoryDeepDreamingConfig({ pluginConfig, cfg: params.cfg });

  return {
    enabled: dreaming.enabled && deep.enabled,
    cron: dreaming.frequency,
    ...(dreaming.timezone ? { timezone: dreaming.timezone } : {}),
    limit: deep.limit,
    ...(typeof deep.maxAgeDays === "number" ? { maxAgeDays: deep.maxAgeDays } : {}),
    recencyHalfLifeDays: deep.recencyHalfLifeDays,
    verboseLogging: dreaming.verboseLogging,
    storageMode: dreaming.storage.mode,
    separateReports: dreaming.storage.separateReports,
  };
}
