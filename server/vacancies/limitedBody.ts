const MAX_BODY_BYTES = 512_000;

/** Тело читается потоком и обрывается на пределе: чужой ответ не занимает память без меры. */
export async function readLimited(response: Response): Promise<string | null> {
  if (Number(response.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
