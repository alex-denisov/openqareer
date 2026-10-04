import { unzipSync } from 'fflate';
import type {
  FootprintAdapter,
  FootprintFinding,
  FootprintMatch,
} from './footprintAdapter';

export interface DocumentMetadataInput {
  readonly buffer: Buffer | Uint8Array;
  readonly filename?: string;
  readonly fileType?: 'pdf' | 'docx' | 'jpeg' | 'png' | 'auto';
  readonly url?: string;
}

interface RawMetadata {
  readonly authors: readonly string[];
  readonly companies: readonly string[];
  readonly software: readonly string[];
  readonly reviewers: readonly {
    readonly name: string;
    readonly date?: string;
    readonly initials?: string;
  }[];
  readonly editHistory: readonly {
    readonly lastModifiedBy?: string;
    readonly revision?: string;
    readonly created?: string;
    readonly modified?: string;
  }[];
  readonly filePaths: readonly string[];
  readonly gps?: {
    readonly latitude: number;
    readonly longitude: number;
    readonly altitude?: number;
  };
}

const EMPTY_METADATA: RawMetadata = {
  authors: [],
  companies: [],
  software: [],
  reviewers: [],
  editHistory: [],
  filePaths: [],
};

export class DocumentMetadataAdapter implements FootprintAdapter<DocumentMetadataInput> {
  readonly id = 'exiftool';
  readonly passive = true as const;

  async run(
    input: DocumentMetadataInput,
    signal?: AbortSignal,
  ): Promise<readonly FootprintFinding[]> {
    if (signal?.aborted) {
      throw new Error('Операция отменена');
    }

    const buf = Buffer.isBuffer(input.buffer)
      ? input.buffer
      : Buffer.from(input.buffer);

    const type = detectFileType(buf, input.filename, input.fileType);
    const parsed = parseByFileType(buf, type);

    const now = new Date().toISOString();
    const query = input.filename ?? 'document_buffer';
    const url = input.url ?? null;

    return buildFindings(parsed, url, query, now);
  }
}

export const documentMetadataAdapter = new DocumentMetadataAdapter();

function detectFileType(
  buf: Buffer,
  filename?: string,
  explicit?: string,
): 'pdf' | 'docx' | 'jpeg' | 'png' | 'unknown' {
  if (explicit && explicit !== 'auto') {
    return explicit as 'pdf' | 'docx' | 'jpeg' | 'png';
  }
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return 'pdf';
  }
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    return 'docx';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return 'png';
  }
  if (filename) {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') return 'pdf';
    if (ext === 'docx' || ext === 'docm') return 'docx';
    if (ext === 'jpg' || ext === 'jpeg') return 'jpeg';
    if (ext === 'png') return 'png';
  }
  return 'unknown';
}

function parseByFileType(
  buf: Buffer,
  type: 'pdf' | 'docx' | 'jpeg' | 'png' | 'unknown',
): RawMetadata {
  switch (type) {
    case 'pdf':
      return parsePdfMetadata(buf);
    case 'docx':
      return parseDocxMetadata(buf);
    case 'jpeg':
      return parseJpegMetadata(buf);
    case 'png':
      return parsePngMetadata(buf);
    default:
      return EMPTY_METADATA;
  }
}

function extractFilePaths(text: string): string[] {
  const paths: string[] = [];
  const winPattern = /(?:[A-Za-z]:\\[^"<>|\r\n\t*?]+)/g;
  const unixPattern = /(?:\/(?:Users|home|private)\/[^"<>|\r\n\t*?]+)/g;

  let match: RegExpExecArray | null;
  while ((match = winPattern.exec(text)) !== null) {
    paths.push(match[0].trim());
  }
  while ((match = unixPattern.exec(text)) !== null) {
    paths.push(match[0].trim());
  }
  return Array.from(new Set(paths));
}

function parsePdfMetadata(buf: Buffer): RawMetadata {
  const text = buf.toString('latin1');
  const authors: string[] = [];
  const companies: string[] = [];
  const software: string[] = [];

  const authorMatch = /\/Author\s*\(([^)]+)\)/i.exec(text);
  if (authorMatch?.[1]) authors.push(authorMatch[1].trim());

  const companyMatch = /\/Company\s*\(([^)]+)\)/i.exec(text);
  if (companyMatch?.[1]) companies.push(companyMatch[1].trim());

  const creatorMatch = /\/Creator\s*\(([^)]+)\)/i.exec(text);
  if (creatorMatch?.[1]) software.push(creatorMatch[1].trim());

  const producerMatch = /\/Producer\s*\(([^)]+)\)/i.exec(text);
  if (producerMatch?.[1]) software.push(producerMatch[1].trim());

  parseXmpPdf(text, authors, companies, software);

  const filePaths = extractFilePaths(text);

  return {
    ...EMPTY_METADATA,
    authors: Array.from(new Set(authors)),
    companies: Array.from(new Set(companies)),
    software: Array.from(new Set(software)),
    filePaths,
  };
}

function parseXmpPdf(
  text: string,
  authors: string[],
  companies: string[],
  software: string[],
): void {
  const xmpMatch = /<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/i.exec(text);
  if (!xmpMatch) return;
  const xmp = xmpMatch[0];

  const dcCreator = /<dc:creator>[\s\S]*?<rdf:li>([^<]+)<\/rdf:li>/i.exec(xmp);
  if (dcCreator?.[1]) authors.push(dcCreator[1].trim());

  const compMatch = /<(?:pdfx|photoshop):Company>([^<]+)<\//i.exec(xmp);
  if (compMatch?.[1]) companies.push(compMatch[1].trim());

  const toolMatch = /<xmp:CreatorTool>([^<]+)<\/xmp:CreatorTool>/i.exec(xmp);
  if (toolMatch?.[1]) software.push(toolMatch[1].trim());

  const prodMatch = /<pdf:Producer>([^<]+)<\/pdf:Producer>/i.exec(xmp);
  if (prodMatch?.[1]) software.push(prodMatch[1].trim());
}

function parseDocxMetadata(buf: Buffer): RawMetadata {
  try {
    const unzipped = unzipSync(new Uint8Array(buf));
    const decoder = new TextDecoder('utf-8');

    const coreXml = unzipped['docProps/core.xml']
      ? decoder.decode(unzipped['docProps/core.xml'])
      : '';
    const appXml = unzipped['docProps/app.xml']
      ? decoder.decode(unzipped['docProps/app.xml'])
      : '';
    const commentsXml = unzipped['word/comments.xml']
      ? decoder.decode(unzipped['word/comments.xml'])
      : '';

    return extractDocxXmlMetadata(coreXml, appXml, commentsXml);
  } catch {
    return EMPTY_METADATA;
  }
}

function extractDocxXmlMetadata(
  coreXml: string,
  appXml: string,
  commentsXml: string,
): RawMetadata {
  const authors: string[] = [];
  const companies: string[] = [];
  const software: string[] = [];
  const editHistory: {
    lastModifiedBy?: string;
    revision?: string;
    created?: string;
    modified?: string;
  }[] = [];

  const creator = /<dc:creator>([^<]+)<\/dc:creator>/i.exec(coreXml)?.[1]?.trim();
  if (creator) authors.push(creator);

  const lastMod = /<cp:lastModifiedBy>([^<]+)<\/cp:lastModifiedBy>/i.exec(coreXml)?.[1]?.trim();
  const rev = /<cp:revision>([^<]+)<\/cp:revision>/i.exec(coreXml)?.[1]?.trim();
  const created = /<dcterms:created[^>]*>([^<]+)<\/dcterms:created>/i.exec(coreXml)?.[1]?.trim();
  const modified = /<dcterms:modified[^>]*>([^<]+)<\/dcterms:modified>/i.exec(coreXml)?.[1]?.trim();

  if (lastMod || rev || created || modified) {
    editHistory.push({ lastModifiedBy: lastMod, revision: rev, created, modified });
  }

  const company = /<Company>([^<]+)<\/Company>/i.exec(appXml)?.[1]?.trim();
  if (company) companies.push(company);

  const app = /<Application>([^<]+)<\/Application>/i.exec(appXml)?.[1]?.trim();
  if (app) software.push(app);

  const reviewers = extractDocxComments(commentsXml);
  const filePaths = extractFilePaths(`${coreXml}\n${appXml}\n${commentsXml}`);

  return {
    ...EMPTY_METADATA,
    authors: Array.from(new Set(authors)),
    companies: Array.from(new Set(companies)),
    software: Array.from(new Set(software)),
    reviewers,
    editHistory,
    filePaths,
  };
}

function extractDocxComments(
  commentsXml: string,
): { name: string; date?: string; initials?: string }[] {
  if (!commentsXml) return [];
  const reviewers: { name: string; date?: string; initials?: string }[] = [];
  const pattern = /<w:comment\b([^>]*)>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(commentsXml)) !== null) {
    const attrs = match[1];
    const author = /w:author="([^"]+)"/i.exec(attrs)?.[1];
    const date = /w:date="([^"]+)"/i.exec(attrs)?.[1];
    const initials = /w:initials="([^"]+)"/i.exec(attrs)?.[1];
    if (author) {
      reviewers.push({ name: author.trim(), date, initials });
    }
  }
  return reviewers;
}

function parseJpegMetadata(buf: Buffer): RawMetadata {
  let offset = 2;
  const authors: string[] = [];
  const software: string[] = [];
  let gps: RawMetadata['gps'];

  while (offset < buf.length - 1) {
    if (buf[offset] !== 0xff) break;
    const marker = buf[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break; // EOI or SOS

    const length = buf.readUInt16BE(offset + 2);
    if (marker === 0xe1 && length >= 8) {
      // APP1
      const header = buf.toString('latin1', offset + 4, offset + 10);
      if (header.startsWith('Exif\0\0')) {
        const exifData = parseExifTiff(buf, offset + 10, length - 8);
        if (exifData.author) authors.push(exifData.author);
        if (exifData.software) software.push(exifData.software);
        if (exifData.gps) gps = exifData.gps;
      }
    }
    offset += 2 + length;
  }

  return {
    ...EMPTY_METADATA,
    authors: Array.from(new Set(authors)),
    software: Array.from(new Set(software)),
    gps,
  };
}

function parsePngMetadata(buf: Buffer): RawMetadata {
  let offset = 8;
  const authors: string[] = [];
  const software: string[] = [];

  while (offset < buf.length - 8) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const dataOffset = offset + 8;

    if (type === 'tEXt' && length > 0) {
      const data = buf.toString('latin1', dataOffset, dataOffset + length);
      const nullIdx = data.indexOf('\0');
      if (nullIdx !== -1) {
        const key = data.slice(0, nullIdx).toLowerCase();
        const value = data.slice(nullIdx + 1).trim();
        if (key === 'author' || key === 'artist') authors.push(value);
        if (key === 'software') software.push(value);
      }
    }
    offset += 12 + length; // 4 len + 4 type + length + 4 crc
  }

  return {
    ...EMPTY_METADATA,
    authors: Array.from(new Set(authors)),
    software: Array.from(new Set(software)),
  };
}

interface ExifParseResult {
  author?: string;
  software?: string;
  gps?: { latitude: number; longitude: number; altitude?: number };
}

function parseExifTiff(buf: Buffer, start: number, maxLen: number): ExifParseResult {
  if (maxLen < 8 || start + 8 > buf.length) return {};
  const isLittle = buf[start] === 0x49 && buf[start + 1] === 0x49;
  const read16 = (o: number) =>
    isLittle ? buf.readUInt16LE(start + o) : buf.readUInt16BE(start + o);
  const read32 = (o: number) =>
    isLittle ? buf.readUInt32LE(start + o) : buf.readUInt32BE(start + o);

  if (read16(2) !== 0x002a) return {};

  const ifd0Offset = read32(4);
  let author: string | undefined;
  let software: string | undefined;
  let gpsOffset: number | undefined;

  parseIfd(buf, start, ifd0Offset, read16, read32, (tag, valOffset, count) => {
    if (tag === 0x013b) author = readTiffString(buf, start, valOffset, count);
    if (tag === 0x0131) software = readTiffString(buf, start, valOffset, count);
    if (tag === 0x8825) gpsOffset = valOffset;
  });

  const gps = gpsOffset
    ? parseGpsIfd(buf, start, gpsOffset, read16, read32)
    : undefined;

  return { author, software, gps };
}

function parseIfd(
  buf: Buffer,
  start: number,
  offset: number,
  read16: (o: number) => number,
  read32: (o: number) => number,
  onTag: (tag: number, val: number, count: number) => void,
): void {
  if (offset + 2 > buf.length - start) return;
  const numEntries = read16(offset);
  for (let i = 0; i < numEntries; i++) {
    const entryOffset = offset + 2 + i * 12;
    if (entryOffset + 12 > buf.length - start) break;
    const tag = read16(entryOffset);
    const count = read32(entryOffset + 4);
    const valOffset = read32(entryOffset + 8);
    onTag(tag, valOffset, count);
  }
}

function readTiffString(buf: Buffer, start: number, offset: number, count: number): string {
  const strStart = start + offset;
  if (strStart >= buf.length) return '';
  return buf.toString('latin1', strStart, Math.min(buf.length, strStart + count)).replace(/\0+$/, '');
}

function parseGpsIfd(
  buf: Buffer,
  start: number,
  offset: number,
  read16: (o: number) => number,
  read32: (o: number) => number,
): { latitude: number; longitude: number; altitude?: number } | undefined {
  let latRef = 'N';
  let lonRef = 'E';
  let latVals: number[] = [];
  let lonVals: number[] = [];
  let altitude: number | undefined;
  const isLittle = buf[start] === 0x49;

  parseIfd(buf, start, offset, read16, read32, (tag, valOffset) => {
    if (tag === 0x0001) {
      const code = isLittle ? (valOffset & 0xff) : ((valOffset >> 24) & 0xff);
      const ch = String.fromCharCode(code);
      if (ch === 'N' || ch === 'S') latRef = ch;
    }
    if (tag === 0x0002) latVals = readRationals(start, valOffset, 3, buf.length, read32);
    if (tag === 0x0003) {
      const code = isLittle ? (valOffset & 0xff) : ((valOffset >> 24) & 0xff);
      const ch = String.fromCharCode(code);
      if (ch === 'E' || ch === 'W') lonRef = ch;
    }
    if (tag === 0x0004) lonVals = readRationals(start, valOffset, 3, buf.length, read32);
    if (tag === 0x0006) {
      const alt = readRationals(start, valOffset, 1, buf.length, read32);
      if (alt.length > 0) altitude = alt[0];
    }
  });

  if (latVals.length === 3 && lonVals.length === 3) {
    let lat = latVals[0] + latVals[1] / 60 + latVals[2] / 3600;
    let lon = lonVals[0] + lonVals[1] / 60 + lonVals[2] / 3600;
    if (latRef === 'S') lat = -lat;
    if (lonRef === 'W') lon = -lon;
    return { latitude: Number(lat.toFixed(6)), longitude: Number(lon.toFixed(6)), altitude };
  }
  return undefined;
}

function readRationals(
  start: number,
  valOffset: number,
  count: number,
  bufLen: number,
  read32: (o: number) => number,
): number[] {
  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    const p = valOffset + i * 8;
    if (start + p + 8 > bufLen) break;
    const num = read32(p);
    const den = read32(p + 4);
    result.push(den !== 0 ? num / den : 0);
  }
  return result;
}

function buildFindings(
  parsed: RawMetadata,
  url: string | null,
  query: string,
  observedAt: string,
): readonly FootprintFinding[] {
  const findings: FootprintFinding[] = [];
  const match: FootprintMatch = 'likely_self';
  const receipt = { method: 'metadata_extract', source: 'documentMetadata', query };

  addGpsFindings(parsed, findings, url, match, observedAt, receipt);
  addCompanyFindings(parsed, findings, url, match, observedAt, receipt);
  addAuthorFindings(parsed, findings, url, match, observedAt, receipt);
  addReviewerFindings(parsed, findings, url, match, observedAt, receipt);
  addHistoryFindings(parsed, findings, url, match, observedAt, receipt);
  addPathFindings(parsed, findings, url, match, observedAt, receipt);
  addSoftwareFindings(parsed, findings, url, match, observedAt, receipt);

  return findings;
}

function addGpsFindings(
  parsed: RawMetadata,
  findings: FootprintFinding[],
  url: string | null,
  match: FootprintMatch,
  observedAt: string,
  receipt: FootprintFinding['receipt'],
): void {
  if (!parsed.gps) return;
  const { latitude, longitude, altitude } = parsed.gps;
  const altText = altitude !== undefined ? `, высота ${altitude}м` : '';
  findings.push({
    adapter: 'exiftool',
    kind: 'metadata',
    url,
    title: 'Метаданные изображения: геолокация (GPS)',
    detail: `В файле обнаружены точные координаты GPS: широта ${latitude}, долгота ${longitude}${altText}. Это раскрывает место съёмки (дом, офис). Риск: высокий.`,
    match,
    observedAt,
    receipt,
  });
}

function addCompanyFindings(
  parsed: RawMetadata,
  findings: FootprintFinding[],
  url: string | null,
  match: FootprintMatch,
  observedAt: string,
  receipt: FootprintFinding['receipt'],
): void {
  for (const company of parsed.companies) {
    findings.push({
      adapter: 'exiftool',
      kind: 'metadata',
      url,
      title: 'Метаданные документа: организация/компания',
      detail: `В файле указана компания: «${company}». Рекрутёр увидит корпоративную принадлежность или лицензиата. Риск: высокий.`,
      match,
      observedAt,
      receipt,
    });
  }
}

function addAuthorFindings(
  parsed: RawMetadata,
  findings: FootprintFinding[],
  url: string | null,
  match: FootprintMatch,
  observedAt: string,
  receipt: FootprintFinding['receipt'],
): void {
  for (const author of parsed.authors) {
    findings.push({
      adapter: 'exiftool',
      kind: 'metadata',
      url,
      title: 'Метаданные документа: автор',
      detail: `В файле указан автор: «${author}». Рекрутёр увидит реальное имя создателя в свойствах файла. Риск: средний.`,
      match,
      observedAt,
      receipt,
    });
  }
}

function addReviewerFindings(
  parsed: RawMetadata,
  findings: FootprintFinding[],
  url: string | null,
  match: FootprintMatch,
  observedAt: string,
  receipt: FootprintFinding['receipt'],
): void {
  for (const rev of parsed.reviewers) {
    const initialsPart = rev.initials ? ` (инициалы: ${rev.initials})` : '';
    const datePart = rev.date ? `, дата: ${rev.date}` : '';
    findings.push({
      adapter: 'exiftool',
      kind: 'metadata',
      url,
      title: 'История правок: рецензент',
      detail: `В документе найдены комментарии рецензента «${rev.name}»${initialsPart}${datePart}. Это раскрывает участников внутренней рецензии. Риск: средний.`,
      match,
      observedAt,
      receipt,
    });
  }
}

function addHistoryFindings(
  parsed: RawMetadata,
  findings: FootprintFinding[],
  url: string | null,
  match: FootprintMatch,
  observedAt: string,
  receipt: FootprintFinding['receipt'],
): void {
  for (const hist of parsed.editHistory) {
    const parts: string[] = [];
    if (hist.lastModifiedBy) parts.push(`редактор: «${hist.lastModifiedBy}»`);
    if (hist.revision) parts.push(`ревизия: ${hist.revision}`);
    if (hist.created) parts.push(`создан: ${hist.created}`);
    if (hist.modified) parts.push(`изменён: ${hist.modified}`);
    if (parts.length > 0) {
      findings.push({
        adapter: 'exiftool',
        kind: 'metadata',
        url,
        title: 'История правок: редакция документа',
        detail: `В файле содержится история правок (${parts.join(', ')}). Рекрутёр сможет проследить процесс подготовки документа. Риск: средний.`,
        match,
        observedAt,
        receipt,
      });
    }
  }
}

function addPathFindings(
  parsed: RawMetadata,
  findings: FootprintFinding[],
  url: string | null,
  match: FootprintMatch,
  observedAt: string,
  receipt: FootprintFinding['receipt'],
): void {
  for (const filePath of parsed.filePaths) {
    findings.push({
      adapter: 'exiftool',
      kind: 'metadata',
      url,
      title: 'Метаданные документа: локальный путь к файлу',
      detail: `В файле найден внутренний путь к файловой системе: «${filePath}». Это раскрывает структуру каталогов и имя пользователя. Риск: средний.`,
      match,
      observedAt,
      receipt,
    });
  }
}

function addSoftwareFindings(
  parsed: RawMetadata,
  findings: FootprintFinding[],
  url: string | null,
  match: FootprintMatch,
  observedAt: string,
  receipt: FootprintFinding['receipt'],
): void {
  for (const app of parsed.software) {
    findings.push({
      adapter: 'exiftool',
      kind: 'metadata',
      url,
      title: 'Метаданные документа: программное обеспечение',
      detail: `В файле указана программа создания: «${app}». Риск: низкий.`,
      match,
      observedAt,
      receipt,
    });
  }
}
