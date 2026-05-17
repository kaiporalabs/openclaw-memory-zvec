import type { ZvecDreamingRuntimeConfig } from "./config.js";
type Logger = {
    info: (message: string) => void;
    warn: (message: string) => void;
    debug?: (message: string) => void;
};
type CronSchedule = {
    kind: "cron";
    expr: string;
    tz?: string;
};
type CronPayload = {
    kind: "systemEvent";
    text: string;
} | {
    kind: "agentTurn";
    message: string;
    lightContext?: boolean;
};
type ManagedCronJobCreate = {
    name: string;
    description: string;
    enabled: boolean;
    schedule: CronSchedule;
    sessionTarget: "main" | "isolated";
    wakeMode: "now";
    payload: CronPayload;
    delivery?: {
        mode: "none";
    };
};
type ManagedCronJobPatch = Partial<ManagedCronJobCreate>;
type ManagedCronJobLike = {
    id: string;
    name?: string;
    description?: string;
    enabled?: boolean;
    schedule?: {
        kind?: string;
        expr?: string;
        tz?: string;
    };
    sessionTarget?: string;
    wakeMode?: string;
    payload?: {
        kind?: string;
        text?: string;
        message?: string;
        lightContext?: boolean;
    };
    delivery?: {
        mode?: string;
    };
    createdAtMs?: number;
};
export type CronServiceLike = {
    list: (opts?: {
        includeDisabled?: boolean;
    }) => Promise<ManagedCronJobLike[]>;
    add: (input: ManagedCronJobCreate) => Promise<unknown>;
    update: (id: string, patch: ManagedCronJobPatch) => Promise<unknown>;
    remove: (id: string) => Promise<{
        removed?: boolean;
    }>;
};
export declare function isManagedZvecDreamingJob(job: ManagedCronJobLike): boolean;
export declare function reconcileZvecDreamingCronJob(params: {
    cron: CronServiceLike | null;
    config: ZvecDreamingRuntimeConfig;
    logger: Logger;
}): Promise<void>;
export declare function resolveCronServiceFromGatewayContext(context: {
    getCron?: () => unknown;
}): CronServiceLike | null;
export declare function hasPendingManagedZvecDreamingCronEvent(sessionKey?: string): boolean;
export {};
//# sourceMappingURL=cron.d.ts.map