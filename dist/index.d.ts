/**
 * OpenClaw Memory (Zvec) — long-term memory with local ANN via `@zvec/zvec`.
 *
 * **Logging:** uses `api.logger` (`info`/`warn`/`debug`). Verbose debug lines require
 * `OPENCLAW_MEMORY_ZVEC_DEBUG=1` or `DEBUG` containing `memory-zvec` — see `debug-env.ts` and the
 * README section “Diagnostics & logging”.
 *
 * **Errors:** hooks use `formatErrorDiagnostic` so embedding/network failures are not truncated to
 * `String(err)`.
 */
declare const _default: {
    id: string;
    name: string;
    description: string;
    configSchema: import("openclaw/plugin-sdk/plugin-entry").OpenClawPluginConfigSchema;
    register: NonNullable<import("openclaw/plugin-sdk/plugin-entry").OpenClawPluginDefinition["register"]>;
} & Pick<import("openclaw/plugin-sdk/plugin-entry").OpenClawPluginDefinition, "reload" | "kind" | "nodeHostCommands" | "securityAuditCollectors">;
export default _default;
//# sourceMappingURL=index.d.ts.map