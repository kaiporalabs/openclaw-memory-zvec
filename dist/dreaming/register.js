import { resolveMemoryDreamingWorkspaces } from "openclaw/plugin-sdk/memory-core-host-status";
import { formatErrorDiagnostic } from "../error-diagnostic.js";
import { hasPendingManagedZvecDreamingCronEvent, reconcileZvecDreamingCronJob, resolveCronServiceFromGatewayContext, } from "./cron.js";
import { resolveZvecDreamingRuntimeConfig } from "./config.js";
import { MEMORY_ZVEC_DREAMING_SYSTEM_EVENT_TEXT } from "./constants.js";
import { markRecallEntriesPromoted, rankRecallPromotionCandidates, } from "../recall-store.js";
import { applyDreamingPromotions, rankDreamingCandidates } from "./promotion.js";
import { includesSystemEventToken } from "./shared.js";
const RUNTIME_CRON_RECONCILE_INTERVAL_MS = 60_000;
const STARTUP_CRON_RETRY_DELAY_MS = 5_000;
const STARTUP_CRON_RETRY_MAX_ATTEMPTS = 12;
function dedupeChunks(chunks) {
    const byId = new Map();
    for (const chunk of chunks) {
        byId.set(chunk.id, chunk);
    }
    return [...byId.values()];
}
async function runZvecDreamingPromotion(params) {
    const workspaces = resolveMemoryDreamingWorkspaces(params.cfg);
    let totalApplied = 0;
    const nowMs = Date.now();
    for (const entry of workspaces) {
        const collected = [];
        for (const agentId of entry.agentIds) {
            const { manager, error } = await params.memoryRuntime.getMemorySearchManager({
                cfg: params.cfg,
                agentId,
                purpose: "cli",
            });
            if (!manager) {
                params.logger.warn(`memory-zvec: dreaming skipped agent ${agentId}: ${error ?? "manager unavailable"}`);
                continue;
            }
            try {
                const zm = manager;
                await zm.sync?.({ reason: "dreaming", force: false });
                collected.push(...zm.exportChunksSnapshot().chunks);
            }
            finally {
                await manager.close?.().catch(() => undefined);
            }
        }
        const chunks = dedupeChunks(collected);
        const recallCandidates = await rankRecallPromotionCandidates({
            workspaceDir: entry.workspaceDir,
            chunks,
            config: {
                limit: params.config.limit,
                minScore: params.config.minPromotionScore,
                minRecallCount: params.config.minRecallCount,
                minUniqueQueries: params.config.minUniqueQueries,
                recencyHalfLifeDays: params.config.recencyHalfLifeDays,
                ...(typeof params.config.maxAgeDays === "number"
                    ? { maxAgeDays: params.config.maxAgeDays }
                    : {}),
                ...(params.config.timezone ? { timezone: params.config.timezone } : {}),
            },
            nowMs,
        });
        const candidates = recallCandidates.length > 0
            ? recallCandidates
            : rankDreamingCandidates({
                chunks,
                nowMs,
                config: params.config,
            });
        if (params.config.verboseLogging) {
            const mode = recallCandidates.length > 0 ? "recall-store" : "recency-fallback";
            params.logger.info(`memory-zvec: dreaming ranked ${candidates.length} candidate(s) [workspace=${entry.workspaceDir}] mode=${mode}`);
        }
        const { applied, promotedCandidates, reportLines } = await applyDreamingPromotions({
            workspaceDir: entry.workspaceDir,
            candidates,
            config: params.config,
            nowMs,
        });
        totalApplied += applied;
        if (promotedCandidates.length > 0) {
            await markRecallEntriesPromoted({
                workspaceDir: entry.workspaceDir,
                candidates: promotedCandidates,
                nowMs,
            });
        }
        if (candidates.length > 0) {
            for (const agentId of entry.agentIds) {
                const { manager, error } = await params.memoryRuntime.getMemorySearchManager({
                    cfg: params.cfg,
                    agentId,
                    purpose: "cli",
                });
                if (!manager) {
                    params.logger.warn(`memory-zvec: dreaming post-promotion sync skipped agent ${agentId}: ${error ?? "manager unavailable"}`);
                    continue;
                }
                try {
                    await manager.sync?.({
                        reason: "dreaming-post-promotion",
                        force: false,
                    });
                }
                finally {
                    await manager.close?.().catch(() => undefined);
                }
            }
        }
        params.logger.info(`memory-zvec: dreaming workspace complete [workspace=${entry.workspaceDir}] ${reportLines.join(" ")}`);
    }
    return { applied: totalApplied, workspaces: workspaces.length };
}
export function registerMemoryZvecDreaming(api, deps) {
    let resolveStartupCron = null;
    let gatewayContext = null;
    let unavailableCronWarningEmitted = false;
    let lastRuntimeReconcileAtMs = 0;
    let lastRuntimeConfigKey = null;
    let lastRuntimeCronRef = null;
    let startupCronRetryTimer = null;
    let startupCronRetryAttempts = 0;
    let disposed = false;
    const resolveCurrentConfig = () => resolveZvecDreamingRuntimeConfig({ cfg: deps.getRuntimeCfg() });
    const configKey = (config) => [
        config.enabled ? "on" : "off",
        config.cron,
        config.timezone ?? "",
        String(config.limit),
        String(config.maxAgeDays ?? ""),
        String(config.recencyHalfLifeDays),
    ].join("|");
    const clearStartupCronRetry = () => {
        if (startupCronRetryTimer) {
            clearTimeout(startupCronRetryTimer);
            startupCronRetryTimer = null;
        }
        startupCronRetryAttempts = 0;
    };
    const hasStartupCron = () => {
        try {
            return Boolean(resolveStartupCron?.());
        }
        catch {
            return false;
        }
    };
    const reconcileCron = async (params) => {
        const cfg = deps.getRuntimeCfg();
        const config = resolveCurrentConfig();
        if (params.reason === "startup") {
            resolveStartupCron = params.startupCron ?? null;
        }
        let cron = resolveStartupCron?.() ?? null;
        if (!cron && params.reason === "runtime" && gatewayContext) {
            cron = resolveCronServiceFromGatewayContext(gatewayContext);
            if (cron) {
                resolveStartupCron = () => cron;
            }
        }
        if (!cron && config.enabled && !unavailableCronWarningEmitted) {
            if (params.reason === "startup") {
                api.logger.debug?.("memory-zvec: cron service not yet available at gateway_start; deferring dreaming cron setup.");
            }
            else {
                api.logger.warn("memory-zvec: managed dreaming cron could not be reconciled (cron service unavailable).");
                unavailableCronWarningEmitted = true;
            }
        }
        if (cron) {
            unavailableCronWarningEmitted = false;
            clearStartupCronRetry();
        }
        const key = configKey(config);
        if (params.reason === "runtime") {
            const now = Date.now();
            if (now - lastRuntimeReconcileAtMs < RUNTIME_CRON_RECONCILE_INTERVAL_MS &&
                lastRuntimeConfigKey === key &&
                lastRuntimeCronRef === cron) {
                return config;
            }
            lastRuntimeReconcileAtMs = now;
            lastRuntimeConfigKey = key;
            lastRuntimeCronRef = cron;
        }
        await reconcileZvecDreamingCronJob({ cron, config, logger: api.logger });
        return config;
    };
    const scheduleStartupCronRetry = () => {
        if (disposed || hasStartupCron()) {
            clearStartupCronRetry();
            return;
        }
        if (startupCronRetryTimer || startupCronRetryAttempts >= STARTUP_CRON_RETRY_MAX_ATTEMPTS) {
            return;
        }
        startupCronRetryTimer = setTimeout(() => {
            startupCronRetryTimer = null;
            if (disposed) {
                return;
            }
            startupCronRetryAttempts += 1;
            void reconcileCron({ reason: "runtime" })
                .then(() => {
                if (disposed || hasStartupCron()) {
                    clearStartupCronRetry();
                    return;
                }
                scheduleStartupCronRetry();
            })
                .catch((err) => {
                if (!disposed) {
                    api.logger.warn(`memory-zvec: deferred dreaming cron retry failed: ${formatErrorDiagnostic(err)}`);
                }
                scheduleStartupCronRetry();
            });
        }, STARTUP_CRON_RETRY_DELAY_MS);
        startupCronRetryTimer.unref?.();
    };
    api.on("gateway_start", async (_event, ctx) => {
        disposed = false;
        gatewayContext = ctx;
        try {
            await reconcileCron({
                reason: "startup",
                startupCron: () => resolveCronServiceFromGatewayContext(ctx),
            });
            scheduleStartupCronRetry();
        }
        catch (err) {
            api.logger.error(`memory-zvec: dreaming startup reconciliation failed: ${formatErrorDiagnostic(err)}`);
        }
    });
    api.on("gateway_stop", () => {
        disposed = true;
        clearStartupCronRetry();
        gatewayContext = null;
        resolveStartupCron = null;
    });
    api.on("before_agent_reply", async (event, ctx) => {
        try {
            if (ctx.trigger !== "heartbeat" && ctx.trigger !== "cron") {
                return undefined;
            }
            const cfg = deps.getRuntimeCfg();
            const hasToken = includesSystemEventToken(event.cleanedBody, MEMORY_ZVEC_DREAMING_SYSTEM_EVENT_TEXT);
            const isManagedTrigger = hasToken &&
                (ctx.trigger === "cron" ||
                    (ctx.trigger === "heartbeat" && hasPendingManagedZvecDreamingCronEvent(ctx.sessionKey)));
            const config = await reconcileCron({ reason: "runtime" });
            if (!isManagedTrigger) {
                return undefined;
            }
            if (!config.enabled) {
                return { handled: true, reason: "memory-zvec: dreaming disabled" };
            }
            const result = await runZvecDreamingPromotion({
                cfg,
                config,
                memoryRuntime: deps.memoryRuntime,
                logger: api.logger,
            });
            api.logger.info(`memory-zvec: dreaming promotion complete (workspaces=${result.workspaces}, applied=${result.applied})`);
            return { handled: true, reason: "memory-zvec: dreaming processed" };
        }
        catch (err) {
            api.logger.error(`memory-zvec: dreaming trigger failed: ${formatErrorDiagnostic(err)}`);
            return undefined;
        }
    });
}
//# sourceMappingURL=register.js.map