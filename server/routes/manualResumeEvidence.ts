import { randomUUID } from 'node:crypto';
import type { CandidateStore } from '../data/candidateStore';
import type { ResumeDraft } from '../domain/resumeDraft';
import { experienceStatement, factStatement } from '../domain/resumeExperienceEvidence';

type ExperienceEntry = ResumeDraft['experience'][number];
type EducationEntry = ResumeDraft['education'][number];
type LanguageEntry = ResumeDraft['languages'][number];
type ProjectEntry = NonNullable<ResumeDraft['projects']>[number];

interface EvidenceBindingInput {
  readonly previousExists: boolean;
  readonly fieldsChanged: boolean;
  readonly previousReference?: string;
  readonly incomingReference?: string;
  readonly statement: string | null;
  readonly allowMissingOnNew: boolean;
  readonly repairMissingManualProject?: boolean;
  readonly entryId?: string;
}

function text(value: string | undefined): string {
  return value?.trim() ?? '';
}

function sameFields(before: readonly unknown[], after: readonly unknown[]): boolean {
  return JSON.stringify(before) === JSON.stringify(after);
}

function experienceFields(entry: ExperienceEntry): readonly unknown[] {
  return [
    text(entry.title),
    text(entry.employer),
    text(entry.location),
    text(entry.startDate),
    text(entry.endDate),
    entry.current,
    text(entry.employmentType),
    entry.workplaceType ?? '',
    entry.teamSize ?? null,
    (entry.skills ?? []).map((skill) => skill.trim()).filter(Boolean),
  ];
}

function educationFields(entry: EducationEntry): readonly unknown[] {
  return [
    text(entry.institution),
    text(entry.qualification),
    text(entry.startDate),
    text(entry.endDate),
    text(entry.description),
  ];
}

function languageFields(entry: LanguageEntry): readonly unknown[] {
  return [text(entry.name), entry.cefr ?? null];
}

function projectFields(entry: ProjectEntry): readonly unknown[] {
  return [
    entry.name.trim(),
    text(entry.description),
    text(entry.employer),
    text(entry.startDate),
    text(entry.endDate),
    entry.current ?? null,
    text(entry.url),
    (entry.skills ?? []).map((skill) => skill.trim()).filter(Boolean),
  ];
}

function educationStatement(entry: EducationEntry): string | null {
  return factStatement('Образование', [
    ['Учебное заведение', entry.institution],
    ['Квалификация', entry.qualification],
    ['Начало', entry.startDate],
    ['Окончание', entry.endDate],
    ['Описание', entry.description],
  ]);
}

function languageStatement(entry: LanguageEntry): string | null {
  return factStatement('Язык', [
    ['Язык', entry.name],
    ['Уровень CEFR', entry.cefr],
  ]);
}

function projectStatement(entry: ProjectEntry): string | null {
  return factStatement('Проект', [
    ['Название', entry.name],
    ['Описание', entry.description],
    ['Работодатель', entry.employer],
    ['Начало', entry.startDate],
    ['Окончание', entry.endDate],
    ['Текущий проект', entry.current],
    ['Ссылка', entry.url],
    [
      'Навыки проекта',
      (entry.skills ?? [])
        .map((skill) => skill.trim())
        .filter(Boolean)
        .join(', '),
    ],
  ]);
}

function isManualReference(memoryId: string | undefined): boolean {
  return memoryId?.startsWith('manual-') ?? false;
}

function isManualProjectId(entryId: string): boolean {
  return /^project-[a-z0-9]{1,8}$/u.test(entryId);
}

function shouldCreateEvidence(input: EvidenceBindingInput): boolean {
  if (!input.statement) return false;
  if (input.previousExists && input.fieldsChanged) return true;
  if (!input.previousExists) {
    return (
      isManualReference(input.incomingReference) ||
      (!input.incomingReference && input.allowMissingOnNew)
    );
  }
  return (
    isManualReference(input.previousReference) ||
    isManualReference(input.incomingReference) ||
    (input.repairMissingManualProject === true &&
      !input.previousReference &&
      !input.incomingReference &&
      isManualProjectId(input.entryId ?? ''))
  );
}

function createCandidateEvidence(
  store: CandidateStore,
  candidateId: string,
  statement: string,
  knownIds: Set<string>,
): string {
  const memoryId = randomUUID();
  store.addManualExperienceFact(candidateId, memoryId, statement);
  knownIds.add(memoryId);
  return memoryId;
}

function bindEvidence(
  store: CandidateStore,
  candidateId: string,
  knownIds: Set<string>,
  input: EvidenceBindingInput,
): string | undefined {
  if (input.previousExists && !input.fieldsChanged) {
    // Preserve the stored binding, including an ineligible or stale one. A
    // save to another section must not confirm imported or pending evidence.
    if (input.previousReference && !isManualReference(input.previousReference)) {
      return input.previousReference;
    }
    if (
      input.incomingReference &&
      !isManualReference(input.incomingReference) &&
      knownIds.has(input.incomingReference)
    ) {
      return input.incomingReference;
    }
  } else if (
    !input.previousExists &&
    input.incomingReference &&
    !isManualReference(input.incomingReference) &&
    knownIds.has(input.incomingReference)
  ) {
    // A new imported row may refer to confirmed or pending candidate evidence.
    return input.incomingReference;
  }

  if (shouldCreateEvidence(input)) {
    return createCandidateEvidence(store, candidateId, input.statement!, knownIds);
  }
  return input.previousReference ?? input.incomingReference;
}

function materializeExperience(
  store: CandidateStore,
  candidateId: string,
  knownIds: Set<string>,
  entry: ExperienceEntry,
  previous: ExperienceEntry | undefined,
): ExperienceEntry {
  const fieldsChanged =
    !previous || !sameFields(experienceFields(previous), experienceFields(entry));
  return {
    ...entry,
    chronologyMemoryId:
      bindEvidence(store, candidateId, knownIds, {
        previousExists: Boolean(previous),
        fieldsChanged,
        previousReference: previous?.chronologyMemoryId,
        incomingReference: entry.chronologyMemoryId,
        statement: experienceStatement(entry),
        allowMissingOnNew: false,
      }) ?? entry.chronologyMemoryId,
  };
}

function materializeEducation(
  store: CandidateStore,
  candidateId: string,
  knownIds: Set<string>,
  entry: EducationEntry,
  previous: EducationEntry | undefined,
): EducationEntry {
  const fieldsChanged = !previous || !sameFields(educationFields(previous), educationFields(entry));
  return {
    ...entry,
    evidenceMemoryId:
      bindEvidence(store, candidateId, knownIds, {
        previousExists: Boolean(previous),
        fieldsChanged,
        previousReference: previous?.evidenceMemoryId,
        incomingReference: entry.evidenceMemoryId,
        statement: educationStatement(entry),
        allowMissingOnNew: false,
      }) ?? entry.evidenceMemoryId,
  };
}

function materializeLanguage(
  store: CandidateStore,
  candidateId: string,
  knownIds: Set<string>,
  entry: LanguageEntry,
  previous: LanguageEntry | undefined,
): LanguageEntry {
  const fieldsChanged = !previous || !sameFields(languageFields(previous), languageFields(entry));
  return {
    ...entry,
    evidenceMemoryId:
      bindEvidence(store, candidateId, knownIds, {
        previousExists: Boolean(previous),
        fieldsChanged,
        previousReference: previous?.evidenceMemoryId,
        incomingReference: entry.evidenceMemoryId,
        statement: languageStatement(entry),
        allowMissingOnNew: false,
      }) ?? entry.evidenceMemoryId,
  };
}

function materializeProject(
  store: CandidateStore,
  candidateId: string,
  knownIds: Set<string>,
  entry: ProjectEntry,
  previous: ProjectEntry | undefined,
): ProjectEntry {
  const fieldsChanged = !previous || !sameFields(projectFields(previous), projectFields(entry));
  return {
    ...entry,
    evidenceMemoryId: bindEvidence(store, candidateId, knownIds, {
      previousExists: Boolean(previous),
      fieldsChanged,
      previousReference: previous?.evidenceMemoryId,
      incomingReference: entry.evidenceMemoryId,
      statement: projectStatement(entry),
      allowMissingOnNew: true,
      repairMissingManualProject: true,
      entryId: entry.id,
    }),
  };
}

/** Links only new/edited candidate-entered rows, inside the enclosing store transaction. */
function materializeExperiences(
  store: CandidateStore,
  candidateId: string,
  knownIds: Set<string>,
  incoming: readonly ExperienceEntry[],
  previous: readonly ExperienceEntry[] | undefined,
): ExperienceEntry[] {
  return incoming.map((entry) =>
    materializeExperience(
      store,
      candidateId,
      knownIds,
      entry,
      previous?.find((item) => item.id === entry.id),
    ),
  );
}

function materializeEducationRows(
  store: CandidateStore,
  candidateId: string,
  knownIds: Set<string>,
  incoming: readonly EducationEntry[],
  previous: readonly EducationEntry[] | undefined,
): EducationEntry[] {
  return incoming.map((entry) =>
    materializeEducation(
      store,
      candidateId,
      knownIds,
      entry,
      previous?.find((item) => item.id === entry.id),
    ),
  );
}

function materializeLanguageRows(
  store: CandidateStore,
  candidateId: string,
  knownIds: Set<string>,
  incoming: readonly LanguageEntry[],
  previous: readonly LanguageEntry[] | undefined,
): LanguageEntry[] {
  return incoming.map((entry) =>
    materializeLanguage(
      store,
      candidateId,
      knownIds,
      entry,
      previous?.find((item) => item.id === entry.id),
    ),
  );
}

function materializeProjectRows(
  store: CandidateStore,
  candidateId: string,
  knownIds: Set<string>,
  incoming: readonly ProjectEntry[] | undefined,
  previous: readonly ProjectEntry[] | undefined,
): ProjectEntry[] | undefined {
  return incoming?.map((entry) =>
    materializeProject(
      store,
      candidateId,
      knownIds,
      entry,
      previous?.find((item) => item.id === entry.id),
    ),
  );
}

export function materializeManualResumeEvidence(
  store: CandidateStore,
  candidateId: string,
  incoming: ResumeDraft,
  previous: ResumeDraft | undefined,
  knownMemoryIds: ReadonlySet<string>,
): ResumeDraft {
  const knownIds = new Set(knownMemoryIds);
  const projects = materializeProjectRows(
    store,
    candidateId,
    knownIds,
    incoming.projects,
    previous?.projects,
  );
  return {
    ...incoming,
    experience: materializeExperiences(
      store,
      candidateId,
      knownIds,
      incoming.experience,
      previous?.experience,
    ),
    education: materializeEducationRows(
      store,
      candidateId,
      knownIds,
      incoming.education,
      previous?.education,
    ),
    languages: materializeLanguageRows(
      store,
      candidateId,
      knownIds,
      incoming.languages,
      previous?.languages,
    ),
    ...(projects ? { projects } : {}),
  };
}
