import { resolveSessionAgentIds } from "openclaw/plugin-sdk/memory-core-host-runtime-core";
export function resolvePluginAgentId(params) {
    const { sessionAgentId } = resolveSessionAgentIds({
        sessionKey: params.sessionKey,
        config: params.cfg,
        agentId: params.agentId,
    });
    return sessionAgentId ?? params.agentId ?? "main";
}
//# sourceMappingURL=agent-context.js.map