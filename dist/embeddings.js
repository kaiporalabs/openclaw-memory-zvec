/**
 * Embedding clients for OpenAI-compatible HTTP APIs and OpenClaw memory embedding adapters.
 * Failures propagate to callers (`ZvecSqliteMemoryManager`, hooks in `index.ts`), which log via
 * `api.logger` and `formatErrorDiagnostic` — this module does not print to the console.
 */
import OpenAI from "openai";
import { getMemoryEmbeddingProvider, } from "openclaw/plugin-sdk/memory-core-host-engine-embeddings";
import { resolveDefaultAgentId } from "openclaw/plugin-sdk/memory-host-core";
import { ensureGlobalUndiciEnvProxyDispatcher } from "openclaw/plugin-sdk/runtime-env";
export function normalizeEmbeddingVector(value) {
    if (Array.isArray(value)) {
        if (!value.every((item) => typeof item === "number" && Number.isFinite(item))) {
            throw new Error("Embedding response contains non-numeric values");
        }
        return value;
    }
    if (typeof value === "string") {
        const bytes = Buffer.from(value, "base64");
        if (bytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
            throw new Error("Base64 embedding response has invalid byte length");
        }
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const floats = [];
        for (let offset = 0; offset < bytes.byteLength; offset += Float32Array.BYTES_PER_ELEMENT) {
            floats.push(view.getFloat32(offset, true));
        }
        return floats;
    }
    throw new Error("Embedding response is missing a vector");
}
class OpenAiCompatibleEmbeddings {
    model;
    dimensions;
    client;
    constructor(apiKey, model, baseUrl, dimensions) {
        this.model = model;
        this.dimensions = dimensions;
        this.client = new OpenAI({ apiKey, baseURL: baseUrl });
    }
    async embed(text, options) {
        const params = {
            model: this.model,
            input: text,
        };
        if (this.dimensions) {
            params.dimensions = this.dimensions;
        }
        ensureGlobalUndiciEnvProxyDispatcher();
        const response = await this.client.post("/embeddings", {
            body: params,
            ...(options?.timeoutMs ? { timeout: options.timeoutMs, maxRetries: 0 } : {}),
        });
        return normalizeEmbeddingVector(response.data?.[0]?.embedding);
    }
}
class ProviderAdapterEmbeddings {
    api;
    embedding;
    providerPromise;
    constructor(api, embedding) {
        this.api = api;
        this.embedding = embedding;
    }
    getProvider() {
        this.providerPromise ??= this.createProvider().catch((err) => {
            this.providerPromise = undefined;
            throw err;
        });
        return this.providerPromise;
    }
    async createProvider() {
        const cfg = (this.api.runtime.config?.current?.() ?? this.api.config);
        const providerId = this.embedding.provider;
        const adapter = getMemoryEmbeddingProvider(providerId, cfg);
        if (!adapter) {
            throw new Error(`Unknown memory embedding provider: ${providerId}`);
        }
        const defaultAgentId = resolveDefaultAgentId(cfg);
        const agentDir = this.api.runtime.agent.resolveAgentDir(cfg, defaultAgentId);
        const remote = this.embedding.apiKey || this.embedding.baseUrl
            ? {
                ...(this.embedding.apiKey ? { apiKey: this.embedding.apiKey } : {}),
                ...(this.embedding.baseUrl ? { baseUrl: this.embedding.baseUrl } : {}),
            }
            : undefined;
        const result = await adapter.create({
            config: cfg,
            agentDir,
            provider: providerId,
            fallback: "none",
            model: this.embedding.model,
            ...(remote ? { remote } : {}),
            ...(typeof this.embedding.dimensions === "number"
                ? { outputDimensionality: this.embedding.dimensions }
                : {}),
        });
        if (!result.provider) {
            throw new Error(`Memory embedding provider ${providerId} is unavailable.`);
        }
        return result.provider;
    }
    async embed(text, _options) {
        return await (await this.getProvider()).embedQuery(text);
    }
}
export function createEmbeddings(api, cfg) {
    const { provider, model, dimensions, apiKey, baseUrl } = cfg.embedding;
    if (provider === "openai" && apiKey) {
        return new OpenAiCompatibleEmbeddings(apiKey, model, baseUrl, dimensions);
    }
    return new ProviderAdapterEmbeddings(api, cfg.embedding);
}
//# sourceMappingURL=embeddings.js.map