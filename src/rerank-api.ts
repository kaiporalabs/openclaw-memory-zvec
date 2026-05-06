export type JinaRerankResponse = {
  results?: Array<{ index?: number; relevance_score?: number; score?: number }>;
  data?: Array<{ index?: number; relevance_score?: number; score?: number }>;
};

export async function rerankWithJinaCompatible(params: {
  endpoint: string;
  apiKey?: string;
  model: string;
  query: string;
  documents: string[];
  timeoutMs: number;
}): Promise<Array<{ index: number; score: number }>> {
  const body = {
    model: params.model,
    query: params.query,
    documents: params.documents.map((text) => ({ text })),
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), params.timeoutMs);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (params.apiKey?.trim()) {
      headers.Authorization = `Bearer ${params.apiKey.trim()}`;
    }
    const res = await fetch(params.endpoint.trim(), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const errTxt = await res.text().catch(() => "");
      throw new Error(`rerank HTTP ${res.status}${errTxt ? `: ${errTxt.slice(0, 200)}` : ""}`);
    }
    const json = (await res.json()) as JinaRerankResponse;
    const rows = json.results ?? json.data ?? [];
    return rows
      .filter((r): r is typeof r & { index: number } => typeof r.index === "number")
      .map((r) => ({
        index: r.index,
        score: typeof r.relevance_score === "number" ? r.relevance_score : Number(r.score ?? 0),
      }));
  } finally {
    clearTimeout(t);
  }
}
