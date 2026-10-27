import type { RecruiterChannel } from '../../../shared/recruiterChannel';
import { transliterateToLatin } from '../recruiterIntelligenceService';
import { samePhoto } from './photoHash';

/**
 * Граф соответствия человека (B258). Одно имя — ещё не человек, а текущая
 * компания — плохой признак для личных аккаунтов: люди меняют работу, в разных
 * местах указывают разных работодателей. Поэтому найденный аккаунт связывается
 * с человеком по любым независимым признакам — как в следе кандидата (Exa):
 * общий контакт или ссылка на уже известный профиль, тот же ник, любой
 * работодатель из истории, город, профессия.
 */
export interface PersonIdentity {
  readonly fullName: string;
  /** Текущий и прошлые работодатели из исходного профиля. */
  readonly employers: readonly string[];
  readonly cities: readonly string[];
  /** Значения уже найденных каналов: адреса, телефоны, ники, ссылки профилей. */
  readonly knownValues: readonly string[];
  /** Отпечатки фото исходного профиля (LinkedIn): то же фото — сильный признак, как общий контакт. */
  readonly photoHashes: readonly string[];
}

export interface IdentityEvidence {
  readonly score: number;
  readonly reasons: readonly string[];
}

/** Порог связи: сильный признак или два слабых. С сильным признаком канал считается подтверждённым. */
export const LINK_THRESHOLD = 2;
export const CONFIRMED_THRESHOLD = 3;

const HR_WORDS = /(?<!\p{L})(?:hr|hrbp|recruit\p{L}*|talent|hiring|рекрут\p{L}*|подбор\p{L}*|найм\p{L}*|кадр\p{L}*|персонал\p{L}*)(?!\p{L})/iu;
const EMPLOYER_MARK = /(?<!\p{L})(?:at|@|в компании|в)\s+([\p{Lu}0-9][\p{L}0-9&.' -]{2,40}?)(?=\s*(?:[,|·\n(]|$|\s-\s))/gu;
const MIN_TOKEN = 3;

function fold(value: string): string {
  return transliterateToLatin(value.normalize('NFKC')).replace(/[^a-z0-9@+]+/gu, ' ').trim();
}

function containsWord(text: string, token: string): boolean {
  const needle = fold(token);
  if (needle.replace(/\s+/gu, '').length < MIN_TOKEN) return false;
  return ` ${fold(text)} `.includes(` ${needle} `);
}

/** Работодатели из текста профиля: «Recruiter at Acme», «HR в компании Ромашка». */
export function employersFromText(text: string): string[] {
  const found = [...text.matchAll(EMPLOYER_MARK)].map((match) => match[1]!.trim());
  return [...new Set(found)].filter((name) => fold(name).length >= MIN_TOKEN).slice(0, 10);
}

/** Связь дают только подтверждённые каналы: догадка не может подтвердить другую догадку. */
function channelValues(channels: readonly RecruiterChannel[]): string[] {
  return channels.filter((channel) => channel.status !== 'hypothesis').flatMap((channel) => {
    const values = [channel.value.replace(/^@/u, '')];
    if (channel.href?.startsWith('https://')) values.push(channel.href.replace(/^https:\/\/(www\.)?/u, '').replace(/\/$/u, ''));
    return values;
  });
}

export function buildIdentity(input: {
  readonly fullName: string;
  readonly companyName: string;
  readonly seedTexts?: readonly string[];
  readonly cities?: readonly string[];
  readonly known?: readonly RecruiterChannel[];
  readonly photoHashes?: readonly string[];
}): PersonIdentity {
  const seed = (input.seedTexts ?? []).join('\n');
  return {
    fullName: input.fullName,
    employers: [...new Set([input.companyName, ...employersFromText(seed)])].filter(Boolean),
    cities: [...new Set(input.cities ?? [])].filter((city) => city.length >= MIN_TOKEN),
    knownValues: [...new Set(channelValues(input.known ?? []))].filter((value) => value.length >= 5),
    photoHashes: [...new Set(input.photoHashes ?? [])],
  };
}

/** Чем найденная страница связана с человеком, кроме имени. */
export function linkEvidence(identity: PersonIdentity, pageText: string, photoHash?: string | null): IdentityEvidence {
  const reasons: string[] = [];
  let score = 0;
  const lower = pageText.toLowerCase();
  // Значение целиком, а не кусок слова: короткий ник не должен находиться где угодно.
  const whole = (value: string) => {
    const escaped = value.toLowerCase().replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'u').test(lower);
  };
  if (identity.knownValues.some(whole)) {
    score += 3;
    reasons.push('shared_contact');
  }
  if (photoHash && identity.photoHashes.some((seed) => samePhoto(seed, photoHash))) {
    score += 3;
    reasons.push('same_photo');
  }
  if (identity.employers.some((employer) => containsWord(pageText, employer))) {
    score += 2;
    reasons.push('employer');
  }
  if (identity.cities.some((city) => containsWord(pageText, city))) {
    score += 1;
    reasons.push('city');
  }
  if (HR_WORDS.test(pageText)) {
    score += 1;
    reasons.push('profession');
  }
  return { score, reasons };
}
