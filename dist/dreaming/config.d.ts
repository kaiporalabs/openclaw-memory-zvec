import type { OpenClawConfig } from "openclaw/plugin-sdk/config-types";
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
export declare function resolveZvecDreamingRuntimeConfig(params: {
    cfg: OpenClawConfig;
}): ZvecDreamingRuntimeConfig;
//# sourceMappingURL=config.d.ts.map