export function resolveAllowedScopes(cfg, agentId) {
    const raw = cfg.scopes.agentAccess?.[agentId];
    if (Array.isArray(raw) && raw.length > 0) {
        return raw.filter((s) => typeof s === "string" && s.trim().length > 0);
    }
    return ["global", `agent:${agentId}`];
}
export function isScopeAllowed(chunkScope, allowed) {
    const s = chunkScope ?? "global";
    return allowed.has(s);
}
//# sourceMappingURL=scopes.js.map