import { strFromU8, unzipSync } from 'fflate';

/**
 * B686: таблица KPI в текст «ячейка | ячейка» по строкам, чтобы модель читала её как текст,
 * а цитаты сверялись с этим же текстом. CSV/TSV и первый лист XLSX, без внешних библиотек.
 */
const ROWS_MAX = 300;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function splitDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      row = [...row, cell];
      cell = '';
    } else if (char === '\n') {
      rows.push([...row, cell]);
      row = [];
      cell = '';
    } else if (char !== '\r') cell += char;
  }
  if (cell || row.length > 0) rows.push([...row, cell]);
  return rows;
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/gu, '&');
}

/** Распакованный лист и общие строки вместе: больше — не таблица KPI (защита от zip-бомбы). */
const XLSX_UNPACKED_MAX = 8 * 1024 * 1024;
const XLSX_PARTS = new Set(['xl/worksheets/sheet1.xml', 'xl/sharedStrings.xml']);

/**
 * Содержимое элементов `<tag ...>…</tag>` (и пустых `<tag/>`) по порядку. Поиск через indexOf:
 * каждый символ просматривается один раз, незакрытые теги не дают квадратичного прохода.
 */
function elements(xml: string, tag: string): string[] {
  const found: string[] = [];
  const close = `</${tag}>`;
  let at = xml.indexOf(`<${tag}`);
  while (at >= 0) {
    const after = xml[at + tag.length + 1];
    const end = xml.indexOf('>', at);
    if (end < 0) break;
    if (after !== '>' && after !== ' ' && after !== '/') {
      at = xml.indexOf(`<${tag}`, end);
      continue;
    }
    if (xml[end - 1] === '/') {
      found.push(xml.slice(at, end + 1));
      at = xml.indexOf(`<${tag}`, end);
      continue;
    }
    const stop = xml.indexOf(close, end);
    if (stop < 0) break;
    found.push(xml.slice(at, stop + close.length));
    at = xml.indexOf(`<${tag}`, stop);
  }
  return found;
}

function inner(element: string): string {
  const start = element.indexOf('>') + 1;
  const end = element.lastIndexOf('</');
  return end > start ? element.slice(start, end) : '';
}

function textRuns(xml: string): string {
  return elements(xml, 't')
    .map((run) => decodeXml(inner(run)))
    .join('');
}

function sharedStrings(files: Record<string, Uint8Array>): string[] {
  const file = files['xl/sharedStrings.xml'];
  return file ? elements(strFromU8(file), 'si').map(textRuns) : [];
}

function cellValue(cell: string, strings: readonly string[]): string {
  const head = cell.slice(0, cell.indexOf('>') + 1);
  const type = /\st="([^"]{1,20})"/u.exec(head)?.[1];
  if (type === 'inlineStr') return textRuns(cell);
  const value = decodeXml(inner(elements(cell, 'v')[0] ?? ''));
  return type === 's' ? (strings[Number(value)] ?? '') : value;
}

function xlsxRows(bytes: Uint8Array): string[][] {
  let unpacked = 0;
  const files = unzipSync(bytes, {
    filter: (file) => {
      if (!XLSX_PARTS.has(file.name)) return false;
      unpacked += file.originalSize;
      if (unpacked > XLSX_UNPACKED_MAX) throw new Error('kpi_table_too_large');
      return true;
    },
  });
  const sheet = files['xl/worksheets/sheet1.xml'];
  if (!sheet) return [];
  const strings = sharedStrings(files);
  return elements(strFromU8(sheet), 'row').map((row) =>
    elements(inner(row), 'c').map((cell) => cellValue(cell, strings)),
  );
}

function rowsOf(bytes: Uint8Array, mimeType: string): string[][] {
  if (mimeType === XLSX) return xlsxRows(bytes);
  const text = strFromU8(bytes).replace(/^\ufeff/u, '');
  return splitDelimited(text, mimeType === 'text/tab-separated-values' ? '\t' : ',');
}

/** Пустая строка — файл не прочитан или в нём нет ячеек. */
export function tableToText(bytes: Uint8Array, mimeType: string): string {
  try {
    return rowsOf(bytes, mimeType)
      .map((row) => row.map((cell) => cell.trim()))
      .filter((row) => row.some(Boolean))
      .slice(0, ROWS_MAX)
      .map((row) => row.join(' | '))
      .join('\n');
  } catch {
    return '';
  }
}
