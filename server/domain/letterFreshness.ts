import { createHash } from 'node:crypto';
import { unbackedLetterNumbers } from './letterModelGate';
import { letterProfileText } from './letterProfile';
import { EMPTY_RESUME_DRAFT, type ResumeDraft } from './resumeDraft';
import { filterUsablePitchFacts, type VacancyPitchInputFact } from './vacancyPitchService';

/**
 * Письмо и текущие факты профиля: кандидат исправил факт — письмо со старым числом не уходит без нового
 * одобрения (24.11: CSAT «23 → 68» в профиле стал «25 → 85», а одобренное письмо хранило прежнее).
 */
export interface LetterFactSource {
  /** Отпечаток профиля письма: изменился — письмо пересобирают. */
  readonly profileHash: string;
  readonly lines: readonly string[];
}

export function letterFactSource(snapshot: {
  readonly memory?: readonly VacancyPitchInputFact[];
  readonly resume?: { readonly draft: ResumeDraft } | null;
}): LetterFactSource {
  const facts = snapshot.memory ?? [];
  const draft = snapshot.resume?.draft ?? EMPTY_RESUME_DRAFT;
  const withheldEvidenceIds = new Set(
    facts.filter((fact) => fact.sensitive === true).map((fact) => fact.id),
  );
  const profile = letterProfileText({ draft, facts, withheldEvidenceIds });
  return {
    profileHash: createHash('sha256').update(profile).digest('hex'),
    lines: [
      ...profile.split('\n'),
      ...filterUsablePitchFacts(facts).map((fact) => fact.statement),
    ],
  };
}

/** С какими фактами сохранён текст письма. У снимков до этого правила данных нет. */
export interface LetterFactMark {
  readonly profileHash: string;
  /** Числа самого кандидата: их и при сохранении не было в профиле, устаревшими они не станут. */
  readonly ownNumbers: readonly string[];
}

/** Метка фактов; `seenHash` — профиль, по которому готовили текст: он прежний — своих чисел у кандидата не считаем. */
export function letterFactMark(
  source: LetterFactSource,
  body: string,
  vacancy: readonly string[],
  seenHash?: string,
): LetterFactMark {
  const sameProfile = seenHash === undefined || seenHash === source.profileHash;
  return {
    profileHash: sameProfile ? source.profileHash : seenHash,
    ownNumbers: sameProfile ? unbackedLetterNumbers(body, source.lines, vacancy) : [],
  };
}

export interface LetterFreshness {
  /** В письме есть число, которое профиль больше не подтверждает. */
  readonly factsChanged: boolean;
  /** Профиль письма стал другим: «Изменить письмо» пересобирает текст. */
  readonly profileChanged: boolean;
}

export function letterFreshness(
  source: LetterFactSource,
  body: string,
  vacancy: readonly string[],
  mark: LetterFactMark | null,
): LetterFreshness {
  const profileChanged = mark?.profileHash !== source.profileHash;
  const own = new Set(mark?.ownNumbers ?? []);
  return {
    profileChanged,
    factsChanged:
      profileChanged &&
      unbackedLetterNumbers(body, source.lines, vacancy).some((number) => !own.has(number)),
  };
}
