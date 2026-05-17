export function normalizeTrimmedString(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
export function includesSystemEventToken(cleanedBody, eventText) {
    const normalizedBody = normalizeTrimmedString(cleanedBody);
    const normalizedEventText = normalizeTrimmedString(eventText);
    if (!normalizedBody || !normalizedEventText) {
        return false;
    }
    if (normalizedBody === normalizedEventText) {
        return true;
    }
    return normalizedBody.split(/\r?\n/).some((line) => {
        const trimmed = line.trim();
        if (trimmed === normalizedEventText) {
            return true;
        }
        return trimmed.replace(/^\[cron:[^\]]+\]\s*/, "") === normalizedEventText;
    });
}
//# sourceMappingURL=shared.js.map