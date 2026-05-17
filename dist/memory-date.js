import { resolveCronStyleNow } from "openclaw/plugin-sdk/memory-core-host-runtime-core";
export function formatDateStampInTimezone(nowMs, timezone) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date(nowMs));
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    if (year && month && day) {
        return `${year}-${month}-${day}`;
    }
    return new Date(nowMs).toISOString().slice(0, 10);
}
export function resolveDailyMemoryRelPath(params) {
    const nowMs = Number.isFinite(params.nowMs) ? params.nowMs : Date.now();
    const { userTimezone } = resolveCronStyleNow(params.cfg ?? {}, nowMs);
    const dateStamp = formatDateStampInTimezone(nowMs, userTimezone);
    return `memory/${dateStamp}.md`;
}
//# sourceMappingURL=memory-date.js.map