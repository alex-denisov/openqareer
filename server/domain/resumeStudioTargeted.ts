import { estimateLength } from './resumeStudioInternals';
import type {
  ResumeDocument,
  ResumeExperience,
  ResumeProject,
  TargetedResumeInput,
  TargetedResumeSlice,
} from './resumeStudioTypes';

const TARGET_TEXT_CHARACTERS_PER_LINE = 88;

interface RankedEntry<Entry> {
  readonly entry: Entry;
  readonly matchedRequirementIndexes: readonly number[];
  readonly originalIndex: number;
}

interface RequirementCoverage {
  readonly requirements: TargetedResumeSlice['requirements'];
  readonly matchedRequirements: readonly string[];
  readonly missingRequirements: readonly string[];
}

interface PreparedTargetedDocument {
  readonly document: ResumeDocument;
  readonly detailedExperienceIds: readonly string[];
  readonly compressedExperienceIds: readonly string[];
  readonly highlightedProjectIds: readonly string[];
}

export function buildTargetedResumeSlice(
  master: ResumeDocument,
  vacancy: TargetedResumeInput,
): TargetedResumeSlice {
  const requirements = normalizeRequirements(vacancy.requirements);
  const coverage = coverRequirements(master, requirements);
  const prepared = prepareTargetedDocument(master, vacancy, requirements, coverage.missingRequirements);
  return {
    ...coverage,
    ...prepared,
    estimatedPages: prepared.document.length.pages,
  };
}

function coverRequirements(
  master: ResumeDocument,
  requirements: readonly { label: string; normalized: string }[],
): RequirementCoverage {
  const facts = documentFactTexts(master);
  const matches = requirements.map((requirement) => ({
    requirement: requirement.label,
    matched: requirementAppears(requirement.normalized, facts),
  }));
  return {
    requirements: matches,
    matchedRequirements: matches.filter((item) => item.matched).map((item) => item.requirement),
    missingRequirements: matches.filter((item) => !item.matched).map((item) => item.requirement),
  };
}

function prepareTargetedDocument(
  master: ResumeDocument,
  vacancy: TargetedResumeInput,
  requirements: readonly { label: string; normalized: string }[],
  missingRequirements: readonly string[],
): PreparedTargetedDocument {
  const experience = targetedExperience(master.experience, requirements);
  const projects = targetedProjects(master.projects ?? [], requirements);
  const skills = targetedSkills(master.skills ?? [], requirements);
  const about =
    requirements.length === 0 ||
    matchingIndexes([master.about ?? ''], requirements).length > 0
      ? master.about
      : null;
  const initialDocument: ResumeDocument = {
    ...master,
    targetRole: clean(vacancy.title) || master.targetRole,
    about,
    experience,
    projects,
    skills,
  };
  const estimatedLength = targetedLength(initialDocument, missingRequirements);
  const document = { ...initialDocument, length: estimatedLength };
  return {
    document,
    detailedExperienceIds: experience
      .filter((role) => role.bullets.length > 0)
      .map((role) => role.id),
    compressedExperienceIds: experience
      .filter((role) => role.bullets.length === 0)
      .map((role) => role.id),
    highlightedProjectIds: projects.map((project) => project.id),
  };
}

function normalizeRequirements(
  requirements: readonly string[],
): Array<{ label: string; normalized: string }> {
  const seen = new Set<string>();
  return requirements.flatMap((requirement) => {
    const label = clean(requirement);
    const normalized = normalizeText(label);
    if (!label || !normalized || seen.has(normalized)) return [];
    seen.add(normalized);
    return [{ label, normalized }];
  });
}

function targetedExperience(
  experience: readonly ResumeExperience[],
  requirements: readonly { normalized: string }[],
): ResumeExperience[] {
  return rankEntries(experience, experienceFactTexts, requirements)
    .map(({ entry, matchedRequirementIndexes }) =>
      requirements.length === 0 || matchedRequirementIndexes.length > 0
        ? entry
        : { ...entry, bullets: [] },
    );
}

function targetedProjects(
  projects: readonly ResumeProject[],
  requirements: readonly { normalized: string }[],
): ResumeProject[] {
  return rankEntries(projects, projectFactTexts, requirements)
    .filter(
      ({ matchedRequirementIndexes }) =>
        requirements.length === 0 || matchedRequirementIndexes.length > 0,
    )
    .map(({ entry }) => entry);
}

function targetedSkills(
  skills: NonNullable<ResumeDocument['skills']>,
  requirements: readonly { normalized: string }[],
) {
  if (requirements.length === 0) return skills;
  return skills.filter((skill) =>
    matchingIndexes([skill.name], requirements).length > 0,
  );
}

function rankEntries<Entry>(
  entries: readonly Entry[],
  getFactTexts: (entry: Entry) => readonly string[],
  requirements: readonly { normalized: string }[],
): RankedEntry<Entry>[] {
  return entries
    .map((entry, originalIndex) => ({
      entry,
      originalIndex,
      matchedRequirementIndexes: matchingIndexes(getFactTexts(entry), requirements),
    }))
    .sort((left, right) => {
      const scoreDifference =
        right.matchedRequirementIndexes.length - left.matchedRequirementIndexes.length;
      if (scoreDifference !== 0) return scoreDifference;
      const leftFirst = left.matchedRequirementIndexes[0] ?? Number.MAX_SAFE_INTEGER;
      const rightFirst = right.matchedRequirementIndexes[0] ?? Number.MAX_SAFE_INTEGER;
      return leftFirst - rightFirst || left.originalIndex - right.originalIndex;
    });
}

function matchingIndexes(
  factTexts: readonly string[],
  requirements: readonly { normalized: string }[],
): number[] {
  return requirements.flatMap((requirement, index) =>
    requirementAppears(requirement.normalized, factTexts) ? [index] : [],
  );
}

function requirementAppears(requirement: string, factTexts: readonly string[]): boolean {
  const paddedRequirement = ` ${requirement} `;
  return factTexts.some((fact) => ` ${normalizeText(fact)} `.includes(paddedRequirement));
}

function documentFactTexts(document: ResumeDocument): string[] {
  return [
    document.about,
    ...document.experience.flatMap(experienceFactTexts),
    ...(document.projects ?? []).flatMap(projectFactTexts),
    ...(document.skills ?? []).map((skill) => skill.name),
    ...document.education.flatMap((item) => assertionTexts([
      item.institution,
      item.qualification,
      item.startDate,
      item.endDate,
    ])),
    ...document.languages.flatMap((item) => assertionTexts([item.name, item.cefr])),
    ...(document.courses ?? []).flatMap((item) => [item.name, item.provider, item.institution]),
    ...(document.tests ?? []).flatMap((item) => [item.name, item.provider, item.score]),
    ...(document.recommendations ?? []).flatMap((item) => [
      item.author,
      item.recommender,
      item.organization,
      item.role,
      item.position,
      item.text,
    ]),
    ...Object.values(document.additional ?? {}),
  ].filter((value): value is string => Boolean(value));
}

function experienceFactTexts(experience: ResumeExperience): string[] {
  return assertionTexts([
    experience.title,
    experience.employer,
    experience.location,
    ...experience.bullets,
  ]);
}

function projectFactTexts(project: ResumeProject): string[] {
  return assertionTexts([
    project.name,
    project.description,
    project.employer,
    ...project.skills,
  ]);
}

function assertionTexts(
  assertions: readonly ({ readonly value: string | boolean } | null)[],
): string[] {
  return assertions.flatMap((item) =>
    item && typeof item.value === 'string' ? [item.value] : [],
  );
}

function targetedLength(
  document: ResumeDocument,
  missingRequirements: readonly string[],
) {
  const baseline = estimateLength(
    document.contact,
    document.experience,
    document.education,
    document.languages,
  );
  const skillLine = (document.skills ?? []).map((skill) => skill.name).filter(Boolean).join(', ');
  const extraLines = [
    document.about,
    skillLine,
    ...(document.projects ?? []).flatMap((project) => projectFactTexts(project)),
    ...(document.courses ?? []).map((course) => course.name),
    ...(document.tests ?? []).map((test) => test.name),
    ...(document.recommendations ?? []).map((item) => item.text ?? item.author ?? item.recommender),
    ...Object.values(document.additional ?? {}),
    ...missingRequirements,
  ].filter((value): value is string => Boolean(value));
  const lines =
    baseline.lines +
    extraLines.reduce(
      (total, value) => total + Math.max(1, Math.ceil(value.length / TARGET_TEXT_CHARACTERS_PER_LINE)),
      0,
    ) +
    Number(missingRequirements.length > 0);
  return {
    lines,
    pages: Math.max(1, Math.ceil(lines / baseline.linesPerPage)),
    linesPerPage: baseline.linesPerPage,
  };
}

function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

function clean(value: string | null | undefined): string {
  return value?.trim() ?? '';
}
