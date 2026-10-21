/**
 * Where each profile fact came from (B541, макет 2: «из LinkedIn, 12.09»,
 * «со слов кандидата», «консультант 06.10»).
 *
 * The origin is read from the import records themselves — the native session
 * receipt, or the platform the import wrote down — never from how the entry
 * looks. A fact with no source at all stays without provenance: the interface
 * then says «источник неизвестен» instead of guessing.
 */

/** 'footprint': a confirmed digital-footprint finding added to the profile (B544). */
export type ImportPlatform = 'linkedin' | 'hh' | 'file' | 'footprint';
export type SourcePlatform = Exclude<ImportPlatform, 'file' | 'footprint'>;

export type FactProvenance =
  | {
      readonly kind: 'import';
      readonly platform: Exclude<ImportPlatform, 'footprint'>;
      readonly at: string;
    }
  | { readonly kind: 'candidate'; readonly at: string }
  | { readonly kind: 'consultant'; readonly at: string }
  | { readonly kind: 'footprint'; readonly at: string };

export type ImportWalkSectionStatus = 'read' | 'pending' | 'failed';

/** The last walk of a source's sections, kept so the profile can show it after a reload. */
export interface ImportWalk {
  readonly platform: SourcePlatform;
  readonly state: 'running' | 'done';
  readonly updatedAt: string;
  readonly sections: readonly {
    readonly key: string;
    readonly status: ImportWalkSectionStatus;
  }[];
}

/** One import message whose platform the importer recorded (B541). */
export interface RecordedImportSource {
  readonly messageId: string;
  readonly platform: ImportPlatform;
  readonly importedAt: string;
  readonly factCount: number;
}

interface NativeReceipt {
  readonly platform: SourcePlatform;
  readonly connectedAt?: string;
  readonly lastImportedAt: string;
  readonly receipt: {
    readonly sourceMessageId: string;
    readonly memoryIds: readonly string[];
    readonly factCount: number;
  };
}

interface ProvenanceMemory {
  readonly id: string;
  readonly sourceMessageIds: readonly string[];
  readonly confidence: string;
  readonly createdAt: string;
}

interface ImportOrigin {
  readonly platform: ImportPlatform;
  /** Undefined for a legacy label import: its date is the fact's own. */
  readonly at?: string;
}

export interface ImportIndexInput {
  readonly native: readonly Omit<NativeReceipt, 'connectedAt'>[];
  readonly recorded: readonly RecordedImportSource[];
  readonly messages: readonly { readonly id: string; readonly content: string }[];
}

export type ImportIndex = ReadonlyMap<string, ImportOrigin>;

/** Labels written by imports that predate the recorded platform. */
const LEGACY_IMPORT_LABELS: ReadonlyArray<[prefix: string, platform: ImportPlatform]> = [
  ['Импорт: профиль LinkedIn', 'linkedin'],
  ['Импорт: резюме hh.ru', 'hh'],
  ['Импорт: PDF-резюме', 'file'],
  ['Импорт: текст резюме', 'file'],
];

function legacyPlatform(content: string): ImportPlatform | undefined {
  return LEGACY_IMPORT_LABELS.find(([prefix]) => content.startsWith(prefix))?.[1];
}

export function buildImportIndex(input: ImportIndexInput): ImportIndex {
  const entries: [string, ImportOrigin][] = [];
  for (const message of input.messages) {
    const platform = legacyPlatform(message.content);
    if (platform) entries.push([message.id, { platform }]);
  }
  for (const connection of input.native) {
    entries.push([
      connection.receipt.sourceMessageId,
      { platform: connection.platform, at: connection.lastImportedAt },
    ]);
  }
  // The importer's own record wins: it is written with the facts, so the date
  // stays the same after the session connection is removed.
  for (const source of input.recorded) {
    entries.push([source.messageId, { platform: source.platform, at: source.importedAt }]);
  }
  return new Map(entries);
}

/**
 * `consultantEdits`: memory id → when an accepted consultant edit wrote that
 * fact. Only such facts read «консультант»; a hypothesis waiting for the
 * candidate is not a profile fact yet and gets no origin.
 */
export function resolveFactProvenance(
  memory: ProvenanceMemory,
  index: ImportIndex,
  consultantEdits: ReadonlyMap<string, string> = new Map(),
): FactProvenance | undefined {
  const editedAt = consultantEdits.get(memory.id);
  if (editedAt) return { kind: 'consultant', at: editedAt };
  const origin = memory.sourceMessageIds
    .map((id) => index.get(id))
    .find((value): value is ImportOrigin => Boolean(value));
  if (origin) {
    const at = origin.at ?? memory.createdAt;
    const { platform } = origin;
    return platform === 'footprint' ? { kind: 'footprint', at } : { kind: 'import', platform, at };
  }
  if (memory.confidence === 'coach-hypothesis') return undefined;
  if (memory.sourceMessageIds.length > 0) return { kind: 'candidate', at: memory.createdAt };
  return undefined;
}

export interface ImportedSourceWithKept {
  readonly platform: SourcePlatform;
  readonly connectedAt: string;
  readonly lastImportedAt: string;
  /** M: everything the last import of this platform brought. */
  readonly factCount: number;
  /** N: facts of that import still in the profile (not rejected). */
  readonly keptFactCount: number;
  readonly walk?: ImportWalk;
}

interface SummaryInput {
  readonly native: readonly NativeReceipt[];
  readonly recorded: readonly RecordedImportSource[];
  readonly messages: readonly { readonly id: string; readonly content: string }[];
  readonly memory: readonly ProvenanceMemory[];
  readonly walks: readonly ImportWalk[];
}

interface LabelTotal {
  readonly latest: string;
  readonly kept: number;
  readonly recordedTotal?: number;
}

/**
 * Native connections win; a label import fills in only a platform without one.
 * N counts the facts still pointing at the platform's import messages, so a
 * rejected (deleted) fact leaves «8 из 9».
 */
export function summarizeImportedSourcesWithKept(input: SummaryInput): ImportedSourceWithKept[] {
  const present = new Set(input.memory.map((entry) => entry.id));
  const walkOf = (platform: SourcePlatform) =>
    input.walks.find((walk) => walk.platform === platform);
  const native = input.native.map((connection) => ({
    platform: connection.platform,
    connectedAt: connection.connectedAt ?? connection.lastImportedAt,
    lastImportedAt: connection.lastImportedAt,
    factCount: connection.receipt.factCount,
    keptFactCount: connection.receipt.memoryIds.filter((id) => present.has(id)).length,
    ...withWalk(walkOf(connection.platform)),
  }));
  const labelled = labelTotals(input);
  const byLabel = [...labelled.entries()]
    .filter(([platform]) => !native.some((connection) => connection.platform === platform))
    .map(([platform, total]) => ({
      platform,
      connectedAt: total.latest,
      lastImportedAt: total.latest,
      factCount: Math.max(total.recordedTotal ?? total.kept, total.kept),
      keptFactCount: total.kept,
      ...withWalk(walkOf(platform)),
    }));
  return [...native, ...byLabel];
}

function withWalk(walk: ImportWalk | undefined): { walk?: ImportWalk } {
  return walk ? { walk } : {};
}

function labelTotals(input: SummaryInput): Map<SourcePlatform, LabelTotal> {
  const index = buildImportIndex({
    native: [],
    recorded: input.recorded,
    messages: input.messages,
  });
  const recordedByMessage = new Map(input.recorded.map((source) => [source.messageId, source]));
  const totals = new Map<SourcePlatform, LabelTotal>();
  for (const entry of input.memory) {
    const messageId = entry.sourceMessageIds.find((id) => index.has(id));
    const origin = messageId ? index.get(messageId) : undefined;
    if (!messageId || !origin || origin.platform === 'file' || origin.platform === 'footprint') continue;
    const at = origin.at ?? entry.createdAt;
    const current = totals.get(origin.platform);
    totals.set(origin.platform, {
      latest: !current || at > current.latest ? at : current.latest,
      kept: (current?.kept ?? 0) + 1,
      recordedTotal: current?.recordedTotal,
    });
  }
  for (const [platform, total] of totals) {
    const recorded = input.recorded.filter(
      (source) => source.platform === platform && recordedByMessage.has(source.messageId),
    );
    const latest = recorded.sort((a, b) => b.importedAt.localeCompare(a.importedAt))[0];
    if (latest) totals.set(platform, { ...total, recordedTotal: latest.factCount });
  }
  return totals;
}
