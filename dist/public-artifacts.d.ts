import type { OpenClawConfig } from "openclaw/plugin-sdk/config-types";
import type { MemoryPluginPublicArtifact } from "openclaw/plugin-sdk/memory-host-core";
export type ListMemoryZvecPublicArtifactsParams = {
    cfg: OpenClawConfig;
    resolveWorkspaceDir: (agentId: string) => string | undefined;
    resolveZvecDataRoot?: () => string | undefined;
};
export declare function listMemoryZvecPublicArtifacts(params: ListMemoryZvecPublicArtifactsParams): Promise<MemoryPluginPublicArtifact[]>;
export declare function defaultZvecDataRootFromCfg(cfg: OpenClawConfig): string | undefined;
//# sourceMappingURL=public-artifacts.d.ts.map