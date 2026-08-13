import { strFromU8, unzipSync } from 'fflate';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export async function extractTextDocument(file: File): Promise<string> {
  if (file.type === DOCX_MIME || file.name.toLowerCase().endsWith('.docx')) {
    return extractDocxText(new Uint8Array(await file.arrayBuffer()));
  }
  if (file.type === 'text/plain' || file.type === 'application/json') {
    return (await file.text()).trim();
  }
  throw new Error('Для этого формата нет текстового извлечения.');
}

function extractDocxText(bytes: Uint8Array): string {
  let files: ReturnType<typeof unzipSync>;
  try {
    files = unzipSync(bytes, {
      filter: (entry) => entry.name === 'word/document.xml',
    });
  } catch {
    throw new Error('DOCX повреждён или не является документом Word.');
  }
  const document = files['word/document.xml'];
  if (!document) throw new Error('В DOCX не найден основной текст документа.');
  const xml = strFromU8(document);
  const text = decodeXml(
    xml
      .replace(/<w:tab\b[^>]*\/?\s*>/giu, '\t')
      .replace(/<w:br\b[^>]*\/?\s*>/giu, '\n')
      .replace(/<\/w:p\s*>/giu, '\n')
      .replace(/<[^>]+>/gu, ''),
  )
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  if (!text) throw new Error('В DOCX не найден читаемый текст.');
  return text;
}

function decodeXml(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/giu, (entity, code: string) => {
    const named: Record<string, string> = {
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'",
    };
    const normalized = code.toLowerCase();
    if (normalized in named) return named[normalized];
    const numeric = normalized.startsWith('#x')
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized.slice(1), 10);
    return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : entity;
  });
}
