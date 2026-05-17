export function resolveMemoryGetRelPath(params) {
    const relPath = (params.relPath ?? params.path ?? "").trim();
    if (!relPath) {
        throw new Error("path or relPath is required");
    }
    return relPath;
}
//# sourceMappingURL=memory-get-params.js.map