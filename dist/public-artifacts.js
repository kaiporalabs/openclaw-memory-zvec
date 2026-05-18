import fs from "node:fs/promises";
import path from "node:path";
import { resolveDefaultDbPath } from "./config.js";
async function pathExists(p) {
    try {
        await fs.access(p);
        return true;
    }
    catch {
        return false;
    }
}
async function listMarkdownFilesRecursive(rootDir) {
    const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch(() => []);
    const files = [];
    for (const entry of entries) {
        const fullPath = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await listMarkdownFilesRecursive(fullPath)));
            continue;
        }
        if (entry.isFile() && entry.name.endsWith(".md")) {
            files.push(fullPath);
        }
    }
    return files.sort((left, right) => left.localeCompare(right));
}
function collectAgentIds(cfg) {
    const agents = cfg.agents;
    if (!agents || typeof agents !== "object") {
        return ["main"];
    }
    const ids = new Set();
    const list = agents.list;
    if (Array.isArray(list)) {
        for (const entry of list) {
            if (typeof entry?.id === "string" && entry.id.trim().length > 0) {
                ids.add(entry.id.trim());
            }
        }
    }
    const entries = agents.entries;
    if (entries && typeof entries === "object") {
        for (const key of Object.keys(entries)) {
            if (key.trim().length > 0) {
                ids.add(key.trim());
            }
        }
    }
    if (ids.size === 0) {
        ids.add("main");
    }
    return [...ids];
}
async function collectWorkspaceArtifacts(params) {
    const artifacts = [];
    const workspaceEntries = new Set((await fs.readdir(params.workspaceDir, { withFileTypes: true }).catch(() => []))
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name));
    for (const relativePath of ["MEMORY.md", "DREAMS.md", "USER.md", "IDENTITY.md"]) {
        if (!workspaceEntries.has(relativePath)) {
            continue;
        }
        const absolutePath = path.join(params.workspaceDir, relativePath);
        artifacts.push({
            kind: "memory-root",
            workspaceDir: params.workspaceDir,
            relativePath,
            absolutePath,
            agentIds: [...params.agentIds],
            contentType: "markdown",
        });
    }
    const memoryDir = path.join(params.workspaceDir, "memory");
    if (await pathExists(memoryDir)) {
        for (const absolutePath of await listMarkdownFilesRecursive(memoryDir)) {
            const relativePath = path.relative(params.workspaceDir, absolutePath).replace(/\\/g, "/");
            if (relativePath.startsWith("memory/dreaming/")) {
                continue;
            }
            artifacts.push({
                kind: "daily-note",
                workspaceDir: params.workspaceDir,
                relativePath,
                absolutePath,
                agentIds: [...params.agentIds],
                contentType: "markdown",
            });
        }
    }
    if (params.zvecDataRoot) {
        const idsPath = path.join(params.zvecDataRoot, "memory-ids.json");
        if (await pathExists(idsPath)) {
            artifacts.push({
                kind: "event-log",
                workspaceDir: params.workspaceDir,
                relativePath: "memory-ids.json",
                absolutePath: idsPath,
                agentIds: [...params.agentIds],
                contentType: "json",
            });
        }
    }
    const deduped = new Map();
    for (const artifact of artifacts) {
        deduped.set(`${artifact.workspaceDir}\0${artifact.relativePath}\0${artifact.kind}`, artifact);
    }
    return [...deduped.values()];
}
export async function listMemoryZvecPublicArtifacts(params) {
    const agentIds = collectAgentIds(params.cfg);
    const artifacts = [];
    const zvecRoot = params.resolveZvecDataRoot?.();
    for (const agentId of agentIds) {
        const workspaceDir = params.resolveWorkspaceDir(agentId);
        if (!workspaceDir) {
            continue;
        }
        artifacts.push(...(await collectWorkspaceArtifacts({
            workspaceDir,
            agentIds: [agentId],
            zvecDataRoot: zvecRoot,
        })));
    }
    const deduped = new Map();
    for (const artifact of artifacts) {
        deduped.set(`${artifact.workspaceDir}\0${artifact.relativePath}\0${artifact.kind}`, artifact);
    }
    return [...deduped.values()];
}
export function defaultZvecDataRootFromCfg(cfg) {
    const entries = cfg.plugins?.entries;
    const zvecEntry = entries?.["memory-zvec"];
    const dbPath = zvecEntry?.config?.dbPath?.trim();
    return dbPath && dbPath.length > 0 ? dbPath : resolveDefaultDbPath();
}
//# sourceMappingURL=public-artifacts.js.map