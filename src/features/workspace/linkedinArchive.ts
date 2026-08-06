import {
  ingestProfileSnapshot,
  type ProfileIngestionResult,
} from './profileIngestion';
import { unzip, type UnzipFileInfo, type Unzipped } from 'fflate';

const MAX_ARCHIVE_FILE_CHARACTERS = 5_000_000;
const MAX_ARCHIVE_ROWS = 2_000;
const MAX_ARCHIVE_COLUMNS = 200;
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_SUPPORTED_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
const ARCHIVE_TIMEOUT_MS = 30_000;
const SUPPORTED_ARCHIVE_FILES = new Set([
  'profile.csv',
  'basic_profile.csv',
  'positions.csv',
  'education.csv',
  'skills.csv',
]);

type CsvRow = Record<string, string>;

interface CsvParserState {
  table: string[][];
  row: string[];
  cell: string;
  inQuotes: boolean;
}

interface ArchiveFilterState {
  supportedBytes: number;
  rejectedForSize: boolean;
}

export interface LinkedInArchiveSource {
  sourceId: string;
  capturedAt: string;
}

export async function ingestLinkedInArchiveZip(
  bytes: Uint8Array,
  source: LinkedInArchiveSource,
): Promise<ProfileIngestionResult> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error('linkedin_archive_zip_size_invalid');
  }
  const files = await extractSupportedArchiveFiles(bytes);
  return ingestLinkedInArchiveFiles(files, source);
}

export function ingestLinkedInArchiveFiles(
  files: Record<string, string>,
  source: LinkedInArchiveSource,
): ProfileIngestionResult {
  const profile = rowsFor(files, ['Profile.csv', 'Basic_Profile.csv'])[0];
  const positions = rowsFor(files, ['Positions.csv']);
  const education = rowsFor(files, ['Education.csv']);
  const skills = rowsFor(files, ['Skills.csv']);

  if (
    !profile &&
    positions.length === 0 &&
    education.length === 0 &&
    skills.length === 0
  ) {
    throw new Error('linkedin_archive_has_no_supported_profile_files');
  }

  return ingestProfileSnapshot({
    state: 'available',
    source: {
      ...source,
      platform: 'linkedin',
      accessPath: 'candidate_export',
    },
    snapshot: {
      headline: field(profile, ['headline']),
      summary: field(profile, ['summary']),
      location: field(profile, ['geo location', 'location']),
      positions: positions.flatMap(positionFromRow),
      education: education.flatMap(educationFromRow),
      skills: skillsFromRows(skills),
    },
  });
}

export function parseCsvRows(source: string): CsvRow[] {
  if (source.length > MAX_ARCHIVE_FILE_CHARACTERS) {
    throw new Error('linkedin_archive_file_too_large');
  }
  if (source.includes('\0')) {
    throw new Error('linkedin_archive_csv_invalid');
  }

  const table = parseCsvTable(source);
  return rowsFromCsvTable(table);
}

function parseCsvTable(source: string): string[][] {
  const state: CsvParserState = {
    table: [],
    row: [],
    cell: '',
    inQuotes: false,
  };
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (state.inQuotes && source[index + 1] === '"') {
        state.cell += '"';
        index += 1;
      } else {
        state.inQuotes = !state.inQuotes;
      }
      continue;
    }
    if (character === ',' && !state.inQuotes) {
      pushCsvCell(state);
      continue;
    }
    if ((character === '\n' || character === '\r') && !state.inQuotes) {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      pushCsvRow(state);
      continue;
    }
    state.cell += character;
  }
  if (state.inQuotes) throw new Error('linkedin_archive_csv_invalid');
  if (state.cell.length > 0 || state.row.length > 0) pushCsvRow(state);
  return state.table;
}

function rowsFromCsvTable(table: string[][]): CsvRow[] {
  if (table.length < 2) return [];
  const headers = table[0].map(normalizeHeader);
  if (
    new Set(headers).size !== headers.length ||
    headers.some((header) => !header)
  ) {
    throw new Error('linkedin_archive_headers_invalid');
  }
  return table.slice(1).map((values) =>
    Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? '']),
    ),
  );
}

function pushCsvCell(state: CsvParserState): void {
  if (state.row.length >= MAX_ARCHIVE_COLUMNS) {
    throw new Error('linkedin_archive_too_many_columns');
  }
  state.row.push(state.cell.trim());
  state.cell = '';
}

function pushCsvRow(state: CsvParserState): void {
  pushCsvCell(state);
  if (state.row.some((value) => value.length > 0)) state.table.push(state.row);
  state.row = [];
  if (state.table.length > MAX_ARCHIVE_ROWS + 1) {
    throw new Error('linkedin_archive_too_many_rows');
  }
}

function rowsFor(files: Record<string, string>, names: string[]): CsvRow[] {
  const expected = new Set(names.map((name) => name.toLowerCase()));
  const match = Object.entries(files).find(([name]) =>
    expected.has(baseName(name).toLowerCase()),
  );
  return match ? parseCsvRows(match[1]) : [];
}

function field(row: CsvRow | undefined, aliases: string[]): string | undefined {
  if (!row) return undefined;
  for (const alias of aliases) {
    const value = row[normalizeHeader(alias)]?.trim();
    if (value) return value;
  }
  return undefined;
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/u, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, ' ');
}

function baseName(path: string): string {
  return path.replace(/\\/gu, '/').split('/').at(-1) ?? path;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function positionFromRow(row: CsvRow) {
  const title = field(row, ['title']);
  const company = field(row, ['company name', 'company']);
  if (!title || !company) return [];
  return [
    {
      title,
      company,
      location: field(row, ['location']),
      startedOn: field(row, ['started on', 'start date']),
      finishedOn: field(row, ['finished on', 'end date']),
      description: field(row, ['description']),
    },
  ];
}

function educationFromRow(row: CsvRow) {
  const school = field(row, ['school name', 'school']);
  if (!school) return [];
  return [
    {
      school,
      degree: field(row, ['degree name', 'degree']),
      startedOn: field(row, ['start date', 'started on']),
      finishedOn: field(row, ['end date', 'finished on']),
      notes: field(row, ['notes', 'activities']),
    },
  ];
}

function skillsFromRows(rows: CsvRow[]): string[] {
  return unique(
    rows
      .map((row) => field(row, ['name', 'skill']))
      .filter((value): value is string => Boolean(value)),
  );
}

function extractSupportedArchiveFiles(
  bytes: Uint8Array,
): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const filterState: ArchiveFilterState = {
      supportedBytes: 0,
      rejectedForSize: false,
    };
    let settled = false;
    let terminate: () => void = () => undefined;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      terminate();
      callback();
    };
    const timeout = setTimeout(() => {
      finish(() => reject(new Error('linkedin_archive_zip_timeout')));
    }, ARCHIVE_TIMEOUT_MS);

    terminate = unzip(
      bytes,
      { filter: (file) => shouldExtractArchiveFile(file, filterState) },
      (error, data) => {
        if (error) {
          finish(() => reject(new Error('linkedin_archive_zip_invalid')));
          return;
        }
        if (filterState.rejectedForSize) {
          finish(() =>
            reject(new Error('linkedin_archive_uncompressed_too_large')),
          );
          return;
        }
        try {
          finish(() => resolve(decodeArchiveFiles(data)));
        } catch {
          finish(() => reject(new Error('linkedin_archive_text_invalid')));
        }
      },
    );
  });
}

function shouldExtractArchiveFile(
  file: UnzipFileInfo,
  state: ArchiveFilterState,
): boolean {
  if (!SUPPORTED_ARCHIVE_FILES.has(baseName(file.name).toLowerCase())) {
    return false;
  }
  state.supportedBytes += file.originalSize;
  if (
    file.originalSize > MAX_ARCHIVE_FILE_CHARACTERS ||
    state.supportedBytes > MAX_SUPPORTED_UNCOMPRESSED_BYTES
  ) {
    state.rejectedForSize = true;
    return false;
  }
  return true;
}

function decodeArchiveFiles(data: Unzipped): Record<string, string> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  return Object.fromEntries(
    Object.entries(data).map(([name, content]) => [
      name,
      decoder.decode(content),
    ]),
  );
}
