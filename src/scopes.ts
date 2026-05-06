import type { MemoryConfig } from "./config.js";

export function resolveAllowedScopes(cfg: MemoryConfig, agentId: string): string[] {
  const raw = cfg.scopes.agentAccess?.[agentId];
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.filter((s) => typeof s === "string" && s.trim().length > 0);
  }
  return ["global", `agent:${agentId}`];
}

export function isScopeAllowed(chunkScope: string | undefined, allowed: Set<string>): boolean {
  const s = chunkScope ?? "global";
  return allowed.has(s);
}
