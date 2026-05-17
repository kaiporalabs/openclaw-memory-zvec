import type { OpenClawConfig } from "openclaw/plugin-sdk/config-types";
import type { MemoryPluginRuntime } from "openclaw/plugin-sdk/memory-core-host-runtime-core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
export type RegisterMemoryZvecDreamingParams = {
    memoryRuntime: MemoryPluginRuntime;
    getRuntimeCfg: () => OpenClawConfig;
};
export declare function registerMemoryZvecDreaming(api: OpenClawPluginApi, deps: RegisterMemoryZvecDreamingParams): void;
//# sourceMappingURL=register.d.ts.map