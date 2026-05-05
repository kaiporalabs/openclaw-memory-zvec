import OpenAI from "openai";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-types";
import {
  getMemoryEmbeddingProvider,
  type MemoryEmbeddingProvider,
} from "openclaw/plugin-sdk/memory-core-host-engine-embeddings";
import { resolveDefaultAgentId } from "openclaw/plugin-sdk/memory-host-core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { ensureGlobalUndiciEnvProxyDispatcher } from "openclaw/plugin-sdk/runtime-env";
import type { MemoryConfig } from "./config.js";

export type Embeddings = {
  embed(text: string, options?: { timeoutMs?: number }): Promise<number[]>;
};

type EmbeddingCreateResponse = {
  data?: Array<{
    embedding?: unknown;
  }>;
};

export function normalizeEmbeddingVector(value: unknown): number[] {
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
    const floats: number[] = [];
    for (let offset = 0; offset < bytes.byteLength; offset += Float32Array.BYTES_PER_ELEMENT) {
      floats.push(view.getFloat32(offset, true));
    }
    return floats;
  }

  throw new Error("Embedding response is missing a vector");
}

class OpenAiCompatibleEmbeddings implements Embeddings {
  private client: OpenAI;

  constructor(
    apiKey: string,
    private model: string,
    baseUrl?: string,
    private dimensions?: number,
  ) {
    this.client = new OpenAI({ apiKey, baseURL: baseUrl });
  }

  async embed(text: string, options?: { timeoutMs?: number }): Promise<number[]> {
    const params: OpenAI.EmbeddingCreateParams = {
      model: this.model,
      input: text,
    };
    if (this.dimensions) {
      params.dimensions = this.dimensions;
    }
    ensureGlobalUndiciEnvProxyDispatcher();
    const response = await this.client.post<EmbeddingCreateResponse>("/embeddings", {
      body: params,
      ...(options?.timeoutMs ? { timeout: options.timeoutMs, maxRetries: 0 } : {}),
    });
    return normalizeEmbeddingVector(response.data?.[0]?.embedding);
  }
}

class ProviderAdapterEmbeddings implements Embeddings {
  private providerPromise: Promise<MemoryEmbeddingProvider> | undefined;

  constructor(
    private api: OpenClawPluginApi,
    private embedding: MemoryConfig["embedding"],
  ) {}

  private getProvider(): Promise<MemoryEmbeddingProvider> {
    this.providerPromise ??= this.createProvider().catch((err) => {
      this.providerPromise = undefined;
      throw err;
    });
    return this.providerPromise;
  }

  private async createProvider(): Promise<MemoryEmbeddingProvider> {
    const cfg = (this.api.runtime.config?.current?.() ?? this.api.config) as OpenClawConfig;
    const providerId = this.embedding.provider;
    const adapter = getMemoryEmbeddingProvider(providerId, cfg);
    if (!adapter) {
      throw new Error(`Unknown memory embedding provider: ${providerId}`);
    }
    const defaultAgentId = resolveDefaultAgentId(cfg);
    const agentDir = this.api.runtime.agent.resolveAgentDir(cfg, defaultAgentId);
    const remote =
      this.embedding.apiKey || this.embedding.baseUrl
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

  async embed(text: string, _options?: { timeoutMs?: number }): Promise<number[]> {
    return await (await this.getProvider()).embedQuery(text);
  }
}

export function createEmbeddings(api: OpenClawPluginApi, cfg: MemoryConfig): Embeddings {
  const { provider, model, dimensions, apiKey, baseUrl } = cfg.embedding;
  if (provider === "openai" && apiKey) {
    return new OpenAiCompatibleEmbeddings(apiKey, model, baseUrl, dimensions);
  }
  return new ProviderAdapterEmbeddings(api, cfg.embedding);
}
