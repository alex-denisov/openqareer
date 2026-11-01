import type { CandidateSnapshot } from '../data/candidateStore';
import { minimizeModelText } from '../providers/modelInputPrivacy';
import type { ResumeDraft } from './resumeDraft';
import { isVacancyFitEvidence, type VacancyFitFact } from './vacancyFit';

/** Profile sections sent besides dossier facts; the model call stays bounded (01.11). */
export const MAX_PROFILE_EVIDENCE_FACTS = 120;
export const MAX_PROFILE_EVIDENCE_CHARS = 600;

type Section =
  | 'headline'
  | 'about'
  | 'experience'
  | 'skill'
  | 'project'
  | 'education'
  | 'certificate'
  | 'language';
type EvidenceSnapshot = Pick<CandidateSnapshot, 'memory' | 'resume'>;

const clean = (text: string): string =>
  minimizeModelText(text).replace(/\s+/gu, ' ').trim().slice(0, MAX_PROFILE_EVIDENCE_CHARS).trim();
const joined = (parts: readonly (string | number | undefined | null)[], separator = ', '): string =>
  parts
    .map((part) => (part === undefined || part === null ? '' : String(part).trim()))
    .filter(Boolean)
    .join(separator);

function profileFact(
  candidateId: string,
  section: Section,
  itemId: string | undefined,
  text: string,
): VacancyFitFact | null {
  const statement = clean(text);
  if (!statement) return null;
  const id = itemId ? `profile:${section}:${itemId}` : `profile:${section}`;
  // The resume draft is the candidate's own entry: confirmed by authorship, cited by its section.
  return {
    id,
    candidateId,
    kind: 'fact',
    status: 'confirmed',
    statement,
    sourceMessageIds: [`profile:${section}`],
    sensitive: false,
    evidenceSource: 'profile',
  };
}

type SectionText = readonly [Section, string | undefined, string];

const period = (start?: string, end?: string, current?: boolean): string =>
  joined([start, current ? 'по н. в.' : end], ' – ');
const skillsOf = (skills?: readonly string[]): string | undefined =>
  skills?.length ? `навыки: ${skills.join(', ')}` : undefined;

/** Places and projects: what the candidate did, where and with which skills. */
function workSections(draft: ResumeDraft): readonly SectionText[] {
  return [
    ...draft.experience.map((item): SectionText => {
      const role = joined([item.title, item.employer], ' — ');
      const team = item.teamSize ? `команда ${item.teamSize}` : undefined;
      const when = period(item.startDate, item.endDate, item.current);
      return ['experience', item.id, joined([role, when, team, skillsOf(item.skills)], '; ')];
    }),
    ...(draft.projects ?? []).map((item): SectionText => [
      'project',
      item.id,
      joined([item.name, item.employer, item.description, skillsOf(item.skills)], '; '),
    ]),
  ];
}

/** Education, certificates, courses and languages. */
function credentialSections(draft: ResumeDraft): readonly SectionText[] {
  return [
    ...draft.education.map((item): SectionText => {
      const when = period(item.startDate, item.endDate);
      return [
        'education',
        item.id,
        joined([item.institution, item.qualification, when, item.description], '; '),
      ];
    }),
    ...(draft.certifications ?? []).map((item): SectionText => [
      'certificate',
      item.id,
      joined([item.name, item.issuer, item.issuedAt], '; '),
    ]),
    ...(draft.courses ?? []).map((item): SectionText => {
      const by = item.provider ?? item.institution;
      return ['certificate', `course-${item.id}`, joined([item.name, by, item.year], '; ')];
    }),
    ...draft.languages.map((item): SectionText => [
      'language',
      item.id,
      joined([item.name, item.cefr, item.sourceLabel], ' — '),
    ]),
  ];
}

function draftSections(draft: ResumeDraft): readonly SectionText[] {
  return [
    ['headline', undefined, draft.candidate.headline ?? ''],
    ['about', undefined, draft.candidate.about ?? ''],
    ...(draft.skills ?? []).map((item): SectionText => [
      'skill',
      item.id,
      joined([item.name, item.level], ' — '),
    ]),
    ...workSections(draft),
    ...credentialSections(draft),
  ];
}

/**
 * Everything the percent may cite (01.11): eligible dossier facts and every profile section, each
 * with an id, provenance and the privacy-cleaned statement the model sees. Consultant hypotheses
 * and open questions are not evidence, so they never change the fit key (B580-r).
 */
export function vacancyFitEvidenceFacts(
  candidateId: string,
  snapshot: EvidenceSnapshot,
): readonly VacancyFitFact[] {
  const memory = snapshot.memory
    .map((fact) => ({ ...fact, candidateId }))
    .filter(isVacancyFitEvidence)
    .map((fact): VacancyFitFact => ({
      ...fact,
      statement: minimizeModelText(fact.statement),
      evidenceSource: 'memory',
    }));
  const draft = snapshot.resume?.draft;
  const seen = new Set<string>();
  const profile = (draft ? draftSections(draft) : [])
    .map(([section, itemId, text]) => profileFact(candidateId, section, itemId, text))
    .filter((fact): fact is VacancyFitFact => {
      if (!fact || seen.has(fact.id)) return false;
      seen.add(fact.id);
      return true;
    })
    .slice(0, MAX_PROFILE_EVIDENCE_FACTS);
  return [...memory, ...profile];
}
