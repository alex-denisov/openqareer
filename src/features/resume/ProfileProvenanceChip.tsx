import { createContext, useContext, type ReactNode } from 'react';
import { LinkSimple, Sparkle, User } from '@phosphor-icons/react';
import type { CandidateMemory, FactProvenance, ImportedSourceSummary } from '../coach/coachApi';
import { provenanceLabel } from './profileProvenance';

interface ProfileProvenanceValue {
  readonly memory: readonly CandidateMemory[];
  readonly importedSources: readonly ImportedSourceSummary[];
}

const ProfileProvenanceContext = createContext<ProfileProvenanceValue>({
  memory: [],
  importedSources: [],
});

/** The profile's facts and sources, so every entry can name its origin without prop threading. */
export function ProfileProvenanceProvider({
  memory,
  importedSources,
  children,
}: ProfileProvenanceValue & { readonly children: ReactNode }) {
  return (
    <ProfileProvenanceContext.Provider value={{ memory, importedSources }}>
      {children}
    </ProfileProvenanceContext.Provider>
  );
}

export function useProfileProvenance(): ProfileProvenanceValue {
  return useContext(ProfileProvenanceContext);
}

function factProvenance(
  memory: readonly CandidateMemory[],
  memoryId: string | undefined,
): FactProvenance | undefined {
  if (!memoryId) return undefined;
  const found = memory.find((entry) => entry.id === memoryId)?.provenance;
  // An entry the candidate added by hand carries a `manual-` id and no imported fact.
  if (!found && memoryId.startsWith('manual-')) return { kind: 'candidate', at: '' };
  return found;
}

export function useFactProvenance(memoryId: string | undefined): FactProvenance | undefined {
  return factProvenance(useProfileProvenance().memory, memoryId);
}

/** For lists: one lookup function instead of a hook per row (390 rows). */
export function useProvenanceLabelOf(): (memoryId: string | undefined) => string {
  const { memory } = useProfileProvenance();
  return (memoryId) => provenanceLabel(factProvenance(memory, memoryId));
}

/** Макет 2: «из LinkedIn, 12.09» / «со слов кандидата» / «выведено консультантом, беседа 06.10». */
export function ProfileProvenanceChip({
  provenance,
}: {
  readonly provenance: FactProvenance | undefined;
}) {
  const Icon =
    provenance?.kind === 'consultant'
      ? Sparkle
      : provenance?.kind === 'candidate'
        ? User
        : LinkSimple;
  return (
    <span className="career-profile-provenance">
      <Icon size={14} aria-hidden="true" />
      {provenanceLabel(provenance)}
    </span>
  );
}

/** The chip for an entry linked to one dossier fact. */
export function ProfileFactProvenance({ memoryId }: { readonly memoryId: string | undefined }) {
  return <ProfileProvenanceChip provenance={useFactProvenance(memoryId)} />;
}
