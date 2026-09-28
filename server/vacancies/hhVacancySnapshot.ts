import type { UnifiedVacancy } from '../domain/unifiedVacancy';

function textOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isTextArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * A repeat search can return an empty snippet for an older vacancy. Keep the
 * useful text and its structured fields until a non-empty snippet arrives.
 * Per-source reads are serialized by MultiSourceVacancyEngine, so a non-empty
 * incoming snippet is the later source snapshot; the separately loaded C61
 * fullDescription remains stronger than any search snippet.
 */
export function mergeHhVacancySnapshot(
  existing: UnifiedVacancy,
  incoming: UnifiedVacancy,
): UnifiedVacancy {
  const existingDescription = textOrEmpty(existing.description);
  const incomingDescription = textOrEmpty(incoming.description);
  const keepExistingSnippet = !incomingDescription.trim() && Boolean(existingDescription.trim());
  const description = keepExistingSnippet ? existingDescription : incomingDescription;
  const responsibilities = keepExistingSnippet
    ? existing.responsibilities
    : incoming.responsibilities;
  const qualifications = keepExistingSnippet ? existing.qualifications : incoming.qualifications;
  const fullDescription =
    textOrEmpty(incoming.fullDescription).trim().length > 0
      ? incoming.fullDescription
      : textOrEmpty(existing.fullDescription).trim().length > 0
        ? existing.fullDescription
        : undefined;
  const keepExistingSkills =
    (!incoming.requiredSkills || incoming.requiredSkills.length === 0) &&
    Boolean(existing.requiredSkills?.length);
  const requiredSkills = keepExistingSkills
    ? existing.requiredSkills
    : incoming.requiredSkills;
  const merged: UnifiedVacancy = {
    ...incoming,
    description,
    ...(requiredSkills ? { requiredSkills: [...requiredSkills] } : {}),
    ...(isTextArray(responsibilities) ? { responsibilities: [...responsibilities] } : {}),
    ...(isTextArray(qualifications) ? { qualifications: [...qualifications] } : {}),
    ...(fullDescription ? { fullDescription } : {}),
  };
  if (!isTextArray(responsibilities)) delete merged.responsibilities;
  if (!isTextArray(qualifications)) delete merged.qualifications;
  if (!fullDescription) delete merged.fullDescription;
  return merged;
}

