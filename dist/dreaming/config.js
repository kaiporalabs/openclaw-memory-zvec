import { resolveMemoryDeepDreamingConfig, resolveMemoryDreamingConfig, resolveMemoryDreamingPluginConfig, } from "openclaw/plugin-sdk/memory-core-host-status";
export function resolveZvecDreamingRuntimeConfig(params) {
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
        minPromotionScore: deep.minScore,
        verboseLogging: dreaming.verboseLogging,
        storageMode: dreaming.storage.mode,
        separateReports: dreaming.storage.separateReports,
    };
}
//# sourceMappingURL=config.js.map