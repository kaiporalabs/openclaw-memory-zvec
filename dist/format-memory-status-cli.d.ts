import type { MemoryProviderStatus } from "openclaw/plugin-sdk/memory-core-host-engine-storage";
/**
 * Human-readable CLI output for `memory status` / `memory-zvec status` / `verify`.
 * Use `--json` on those commands for machine-readable output.
 */
export declare function formatMemoryStatusHuman(status: MemoryProviderStatus): string;
export declare function formatMemoryStatusCliOutput(payload: {
    ok: boolean;
    status?: MemoryProviderStatus;
    error?: string;
    json?: boolean;
}): string;
//# sourceMappingURL=format-memory-status-cli.d.ts.map