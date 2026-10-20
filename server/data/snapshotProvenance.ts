import {
  buildImportIndex,
  resolveFactProvenance,
  summarizeImportedSourcesWithKept,
  type ImportWalk,
  type RecordedImportSource,
} from '../domain/factProvenance';
import type {
  ImportedSourceSummary,
  StoredMemory,
  StoredNativeSourceConnection,
} from './candidateStore';

interface ProvenanceSources {
  /** Accepted consultant edits that are still in place (not reverted). */
  readonly consultantEdits?: readonly {
    readonly appliedChronologyMemoryId?: string | null;
    readonly createdAt: string;
    readonly revertedAt?: string | null;
  }[];
  readonly native: readonly StoredNativeSourceConnection[];
  readonly recorded: readonly RecordedImportSource[];
  readonly walks: readonly ImportWalk[];
}

/** B541: the snapshot's sources with «N из M» and walk, and each fact with its origin. */
export function withImportProvenance(
  parts: {
    readonly messages: readonly { readonly id: string; readonly content: string }[];
    readonly memory: readonly StoredMemory[];
  },
  sources: ProvenanceSources,
): { importedSources: ImportedSourceSummary[]; memory: StoredMemory[] } {
  const input = { native: sources.native, recorded: sources.recorded, messages: parts.messages };
  const index = buildImportIndex(input);
  const edits = new Map(
    (sources.consultantEdits ?? []).flatMap((edit) =>
      edit.appliedChronologyMemoryId && !edit.revertedAt
        ? [[edit.appliedChronologyMemoryId, edit.createdAt] as const]
        : [],
    ),
  );
  return {
    importedSources: summarizeImportedSourcesWithKept({
      ...input,
      memory: parts.memory,
      walks: sources.walks,
    }),
    memory: parts.memory.map((entry) => {
      const provenance = resolveFactProvenance(entry, index, edits);
      return provenance ? { ...entry, provenance } : entry;
    }),
  };
}
