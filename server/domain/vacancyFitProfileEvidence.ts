import type { CandidateSnapshot } from '../data/candidateStore';
import { minimizeModelText } from '../providers/modelInputPrivacy';
import type { ResumeDraft } from './resumeDraft';
import { isVacancyFitEvidence, type VacancyFitFact } from './vacancyFit';

/** Profile sections sent besides dossier facts; the model call stays bounded (01.11). */
export const MAX_PROFILE_EVIDENCE_FACTS = 120;
export const MAX_PROFILE_EVIDENCE_CHARS = 600;
/** A place carries its description and bullets (02.11: P&L lived there and was never sent). */
export const MAX_EXPERIENCE_EVIDENCE_CHARS = 1500;
/**
 * Bytes of the facts JSON the model sees. The bulk client refuses a call whose upper bound exceeds
 * the $0.01 hold (~58 KB with 4096 output tokens) before the network: 01.11 a large profile hit it
 * on every vacancy and the recount stood still as «model unavailable».
 */
export const MAX_FIT_EVIDENCE_BYTES = 32_000;

type Section =
  | 'location'
  | 'achievement'
  | 'headline'
  | 'about'
  | 'experience'
  | 'skill'
  | 'project'
  | 'education'
  | 'certificate'
  | 'language';
type EvidenceSnapshot = Pick<CandidateSnapshot, 'memory' | 'resume'>;

const clean = (text: string, limit = MAX_PROFILE_EVIDENCE_CHARS): string =>
  minimizeModelText(text).replace(/\s+/gu, ' ').trim().slice(0, limit).trim();
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
  const statement = clean(
    text,
    section === 'experience' ? MAX_EXPERIENCE_EVIDENCE_CHARS : undefined,
  );
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

/** Memory text by id, whatever its status: the resume draft points at it as the candidate's own entry. */
type MemoryText = (id: string | undefined) => string | undefined;

/** Places and projects: what the candidate did, where and with which skills. */
function workSections(draft: ResumeDraft, text: MemoryText): readonly SectionText[] {
  return [
    ...draft.experience.map((item): SectionText => {
      const role = joined([item.title, item.employer], ' — ');
      const team = item.teamSize ? `команда ${item.teamSize}` : undefined;
      const when = period(item.startDate, item.endDate, item.current);
      // What was done comes before the tags, so the length bound cuts tags, not P&L (02.11).
      const done = [text(item.descriptionMemoryId), ...(item.bulletMemoryIds ?? []).map(text)];
      return [
        'experience',
        item.id,
        joined([role, when, team, ...done, skillsOf(item.skills)], '; '),
      ];
    }),
    ...(draft.achievements ?? []).map((item): SectionText => [
      'achievement',
      item.id,
      joined([item.title, item.role, item.issuer, item.date, item.description], '; '),
    ]),
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

function draftSections(draft: ResumeDraft, text: MemoryText): readonly SectionText[] {
  const location = draft.candidate.contact?.location;
  return [
    // Conditions (work authorisation, country-restricted remote) are judged against where they live.
    ['location', undefined, location ? `Местоположение: ${location}` : ''],
    ['headline', undefined, draft.candidate.headline ?? ''],
    ['about', undefined, draft.candidate.about ?? ''],
    ...(draft.skills ?? []).map((item): SectionText => [
      'skill',
      item.id,
      joined([item.name, item.level], ' — '),
    ]),
    ...workSections(draft, text),
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
  const byId = new Map(snapshot.memory.map((fact) => [fact.id, fact.statement]));
  const text: MemoryText = (id) => (id ? byId.get(id) : undefined);
  const profile = (draft ? draftSections(draft, text) : [])
    .map(([section, itemId, text]) => profileFact(candidateId, section, itemId, text))
    .filter((fact): fact is VacancyFitFact => {
      if (!fact || seen.has(fact.id)) return false;
      seen.add(fact.id);
      return true;
    })
    .slice(0, MAX_PROFILE_EVIDENCE_FACTS);
  return withinBytes([...profile, ...memory]);
}

/** The candidate's own profile first, then dossier facts, until the prompt budget is spent. */
function withinBytes(facts: readonly VacancyFitFact[]): readonly VacancyFitFact[] {
  let bytes = 2;
  return facts.filter((fact) => {
    const size = Buffer.byteLength(JSON.stringify({ id: fact.id, statement: fact.statement })) + 1;
    if (bytes + size > MAX_FIT_EVIDENCE_BYTES) return false;
    bytes += size;
    return true;
  });
}
