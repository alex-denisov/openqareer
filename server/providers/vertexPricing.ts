/**
 * Catalog price of gemini-3.8-flash on Vertex per million tokens (28.10). It is the upper estimate the
 * daily Gemini cap counts with: the cache is not discounted. Output tokens are the answer plus the
 * model's thinking.
 */
export const VERTEX_INPUT_PER_MILLION_USD = 0.825;
export const VERTEX_OUTPUT_PER_MILLION_USD = 4.125;

export interface VertexUsageMetadata {
  readonly promptTokenCount?: number;
  readonly candidatesTokenCount?: number;
  readonly thoughtsTokenCount?: number;
  readonly cachedContentTokenCount?: number;
}

const count = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

export function vertexOutputTokens(usage: VertexUsageMetadata | undefined): number {
  return count(usage?.candidatesTokenCount) + count(usage?.thoughtsTokenCount);
}

export function vertexCallCostUsd(usage: VertexUsageMetadata | undefined): number {
  return (
    (count(usage?.promptTokenCount) * VERTEX_INPUT_PER_MILLION_USD +
      vertexOutputTokens(usage) * VERTEX_OUTPUT_PER_MILLION_USD) /
    1e6
  );
}
