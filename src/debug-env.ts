/**
 * Opt-in verbose diagnostics for `@kaiporalabs/openclaw-memory-zvec`.
 *
 * When true, the plugin emits extra `api.logger.debug` calls (for example on the auto-recall path).
 * Whether those lines appear depends on the gateway/host log level.
 *
 * Enable with either:
 * - `OPENCLAW_MEMORY_ZVEC_DEBUG=1`
 * - `DEBUG` containing the substring `memory-zvec` (same convention as many Node tools)
 *
 * Documented in the package README under “Diagnostics & logging”.
 *
 * @see https://github.com/kaiporalabs/openclaw-memory-zvec
 */
export function isMemoryZvecDebug(): boolean {
  return (
    process.env.OPENCLAW_MEMORY_ZVEC_DEBUG === "1" ||
    (typeof process.env.DEBUG === "string" && process.env.DEBUG.includes("memory-zvec"))
  );
}
