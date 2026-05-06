import type { MemoryConfig } from "./config.js";
export declare function resolveAllowedScopes(cfg: MemoryConfig, agentId: string): string[];
export declare function isScopeAllowed(chunkScope: string | undefined, allowed: Set<string>): boolean;
//# sourceMappingURL=scopes.d.ts.map