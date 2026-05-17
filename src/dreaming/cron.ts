import { normalizeLowercaseStringOrEmpty } from "openclaw/plugin-sdk/text-runtime";
import { peekSystemEventEntries } from "openclaw/plugin-sdk/system-event-runtime";
import type { ZvecDreamingRuntimeConfig } from "./config.js";
import {
  MANAGED_MEMORY_ZVEC_DREAMING_CRON_NAME,
  MANAGED_MEMORY_ZVEC_DREAMING_CRON_TAG,
  MEMORY_ZVEC_DREAMING_SYSTEM_EVENT_TEXT,
} from "./constants.js";
import { normalizeTrimmedString } from "./shared.js";

type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  debug?: (message: string) => void;
};

type CronSchedule = { kind: "cron"; expr: string; tz?: string };
type CronPayload =
  | { kind: "systemEvent"; text: string }
  | { kind: "agentTurn"; message: string; lightContext?: boolean };

type ManagedCronJobCreate = {
  name: string;
  description: string;
  enabled: boolean;
  schedule: CronSchedule;
  sessionTarget: "main" | "isolated";
  wakeMode: "now";
  payload: CronPayload;
  delivery?: { mode: "none" };
};

type ManagedCronJobPatch = Partial<ManagedCronJobCreate>;

type ManagedCronJobLike = {
  id: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  schedule?: { kind?: string; expr?: string; tz?: string };
  sessionTarget?: string;
  wakeMode?: string;
  payload?: {
    kind?: string;
    text?: string;
    message?: string;
    lightContext?: boolean;
  };
  delivery?: { mode?: string };
  createdAtMs?: number;
};

export type CronServiceLike = {
  list: (opts?: { includeDisabled?: boolean }) => Promise<ManagedCronJobLike[]>;
  add: (input: ManagedCronJobCreate) => Promise<unknown>;
  update: (id: string, patch: ManagedCronJobPatch) => Promise<unknown>;
  remove: (id: string) => Promise<{ removed?: boolean }>;
};

const HEARTBEAT_ISOLATED_SESSION_SUFFIX = ":heartbeat";

function resolveManagedCronDescription(config: ZvecDreamingRuntimeConfig): string {
  return `${MANAGED_MEMORY_ZVEC_DREAMING_CRON_TAG} Promote recent memory/ daily notes into MEMORY.md (limit=${config.limit}, recencyHalfLifeDays=${config.recencyHalfLifeDays}, maxAgeDays=${config.maxAgeDays ?? "none"}).`;
}

function buildManagedDreamingCronJob(config: ZvecDreamingRuntimeConfig): ManagedCronJobCreate {
  return {
    name: MANAGED_MEMORY_ZVEC_DREAMING_CRON_NAME,
    description: resolveManagedCronDescription(config),
    enabled: true,
    schedule: {
      kind: "cron",
      expr: config.cron,
      ...(config.timezone ? { tz: config.timezone } : {}),
    },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: {
      kind: "agentTurn",
      message: MEMORY_ZVEC_DREAMING_SYSTEM_EVENT_TEXT,
      lightContext: true,
    },
    delivery: { mode: "none" },
  };
}

function resolvePayloadToken(payload: ManagedCronJobLike["payload"]): string | undefined {
  const kind = normalizeLowercaseStringOrEmpty(normalizeTrimmedString(payload?.kind));
  if (kind === "systemevent") {
    return normalizeTrimmedString(payload?.text);
  }
  if (kind === "agentturn") {
    return normalizeTrimmedString(payload?.message);
  }
  return undefined;
}

export function isManagedZvecDreamingJob(job: ManagedCronJobLike): boolean {
  const description = normalizeTrimmedString(job.description);
  if (description?.includes(MANAGED_MEMORY_ZVEC_DREAMING_CRON_TAG)) {
    return true;
  }
  const name = normalizeTrimmedString(job.name);
  const token = resolvePayloadToken(job.payload);
  return name === MANAGED_MEMORY_ZVEC_DREAMING_CRON_NAME && token === MEMORY_ZVEC_DREAMING_SYSTEM_EVENT_TEXT;
}

function buildPatch(job: ManagedCronJobLike, desired: ManagedCronJobCreate): ManagedCronJobPatch | null {
  const patch: ManagedCronJobPatch = {};
  if (normalizeTrimmedString(job.name) !== desired.name) {
    patch.name = desired.name;
  }
  if (normalizeTrimmedString(job.description) !== desired.description) {
    patch.description = desired.description;
  }
  if (job.enabled !== true) {
    patch.enabled = true;
  }
  if (
    normalizeLowercaseStringOrEmpty(normalizeTrimmedString(job.schedule?.kind)) !== "cron" ||
    normalizeTrimmedString(job.schedule?.expr) !== desired.schedule.expr ||
    normalizeTrimmedString(job.schedule?.tz) !== desired.schedule.tz
  ) {
    patch.schedule = desired.schedule;
  }
  if (normalizeLowercaseStringOrEmpty(normalizeTrimmedString(job.sessionTarget)) !== desired.sessionTarget) {
    patch.sessionTarget = desired.sessionTarget;
  }
  const token = resolvePayloadToken(job.payload);
  const desiredToken =
    desired.payload.kind === "systemEvent" ? desired.payload.text : desired.payload.message;
  if (
    normalizeLowercaseStringOrEmpty(normalizeTrimmedString(job.payload?.kind)) !==
      normalizeLowercaseStringOrEmpty(desired.payload.kind) ||
    token !== desiredToken
  ) {
    patch.payload = desired.payload;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

export async function reconcileZvecDreamingCronJob(params: {
  cron: CronServiceLike | null;
  config: ZvecDreamingRuntimeConfig;
  logger: Logger;
}): Promise<void> {
  const { cron, config, logger } = params;
  if (!cron) {
    return;
  }

  const jobs = await cron.list({ includeDisabled: true });
  const managed = jobs.filter(isManagedZvecDreamingJob);
  const desired = buildManagedDreamingCronJob(config);

  if (!config.enabled) {
    let removed = 0;
    for (const job of managed) {
      const result = await cron.remove(job.id);
      if (result.removed === true) {
        removed++;
      }
    }
    if (removed > 0) {
      logger.info(`memory-zvec: removed ${removed} managed dreaming cron job(s).`);
    }
    return;
  }

  if (managed.length === 0) {
    await cron.add(desired);
    logger.info("memory-zvec: created managed dreaming cron job.");
    return;
  }

  const sorted = [...managed].sort((a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0));
  const primary = sorted[0]!;
  for (const duplicate of sorted.slice(1)) {
    await cron.remove(duplicate.id);
  }
  const patch = buildPatch(primary, desired);
  if (patch) {
    await cron.update(primary.id, patch);
    logger.info("memory-zvec: updated managed dreaming cron job.");
  }
}

export function resolveCronServiceFromGatewayContext(context: {
  getCron?: () => unknown;
}): CronServiceLike | null {
  const raw = context.getCron?.();
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const cron = raw as Partial<CronServiceLike>;
  if (
    typeof cron.list !== "function" ||
    typeof cron.add !== "function" ||
    typeof cron.update !== "function" ||
    typeof cron.remove !== "function"
  ) {
    return null;
  }
  return cron as CronServiceLike;
}

function resolveDreamingTriggerSessionKeys(sessionKey?: string): string[] {
  const normalized = normalizeTrimmedString(sessionKey);
  if (!normalized) {
    return [];
  }
  const keys = [normalized];
  if (normalized.endsWith(HEARTBEAT_ISOLATED_SESSION_SUFFIX)) {
    const base = normalized.slice(0, -HEARTBEAT_ISOLATED_SESSION_SUFFIX.length).trim();
    if (base) {
      keys.push(base);
    }
  }
  return [...new Set(keys)];
}

export function hasPendingManagedZvecDreamingCronEvent(sessionKey?: string): boolean {
  return resolveDreamingTriggerSessionKeys(sessionKey).some((key) =>
    peekSystemEventEntries(key).some(
      (event) =>
        event.contextKey?.startsWith("cron:") === true &&
        normalizeTrimmedString(event.text) === MEMORY_ZVEC_DREAMING_SYSTEM_EVENT_TEXT,
    ),
  );
}
