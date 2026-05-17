import type { OpenClawConfig } from "openclaw/plugin-sdk/config-types";
import { resolveSessionAgentIds } from "openclaw/plugin-sdk/memory-core-host-runtime-core";

export function resolvePluginAgentId(params: {
  agentId?: string;
  sessionKey?: string;
  cfg: OpenClawConfig;
}): string {
  const { sessionAgentId } = resolveSessionAgentIds({
    sessionKey: params.sessionKey,
    config: params.cfg,
    agentId: params.agentId,
  });
  return sessionAgentId ?? params.agentId ?? "main";
}
