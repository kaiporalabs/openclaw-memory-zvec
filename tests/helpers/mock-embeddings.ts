import type { Embeddings } from "../../src/embeddings.js";

const DIM = 8;

export function createMockEmbeddings(dim = DIM): Embeddings {
  return {
    async embed(text: string) {
      const vec = new Array(dim).fill(0);
      for (let i = 0; i < text.length; i++) {
        vec[i % dim] = (vec[i % dim] + text.charCodeAt(i)) % 1;
      }
      return vec;
    },
  };
}

export const MOCK_EMBED_DIM = DIM;
