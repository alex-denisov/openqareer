const DEFAULT_MAX_BYTES = 1_000_000;

export async function readBoundedJson(
  response: Response,
  maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<unknown> {
  return JSON.parse(await readBoundedText(response, maxBytes));
}

export async function readBoundedText(
  response: Response,
  maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<string> {
  const contentLength = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error('vacancy_source_response_too_large');
  }
  if (!response.body) throw new Error('vacancy_source_response_invalid');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error('vacancy_source_response_too_large');
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}
