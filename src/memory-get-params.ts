export function resolveMemoryGetRelPath(params: { path?: string; relPath?: string }): string {
  const relPath = (params.relPath ?? params.path ?? "").trim();
  if (!relPath) {
    throw new Error("path or relPath is required");
  }
  return relPath;
}
