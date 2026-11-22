import type { SmmPost, SmmStore } from './smmStore';

/**
 * Голос владельца для вариантов по примеру: его собственные посты (origin 'owner')
 * и принятые посты с настоящими цифрами. Посты контент-стратегии (origin 'schedule')
 * образцом служат, только если по цифрам они не хуже середины: слабые не в счёт,
 * без цифр тоже.
 */
export const OWNER_POST_ORIGIN = 'owner';
const SCHEDULE_ORIGIN = 'schedule';
const VOICE_SAMPLES = 3;
const SAMPLE_MAX_CHARS = 1_200;
const CANDIDATES = 200;
const CLICK_WEIGHT = 20;

const NUMBER = String.raw`(\d+(?:[\s\u00a0]\d{3})*(?:[.,]\d+)?)\s*(к|k|тыс\.?)?\s*`;
const REACH = new RegExp(`${NUMBER}(?:просмотр|охват|показ|views|impressions|reach)`, 'giu');
const CLICKS = new RegExp(`${NUMBER}(?:переход|клик|click)`, 'giu');

function amount(digits: string, suffix: string | undefined): number {
  const value = Number(digits.replace(/\s/gu, '').replace(',', '.'));
  if (!Number.isFinite(value)) return 0;
  return suffix ? Math.round(value * 1_000) : value;
}

function largest(pattern: RegExp, text: string): number {
  let best = 0;
  for (const match of text.matchAll(pattern)) best = Math.max(best, amount(match[1]!, match[2]));
  return best;
}

/** Охват и переходы из свободной записи владельца («1,2к просмотров, 14 переходов»). */
export function metricsScore(metrics: string | null): number {
  if (!metrics) return 0;
  return largest(REACH, metrics) + CLICK_WEIGHT * largest(CLICKS, metrics);
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

export function voiceSamples(store: SmmStore, limit = VOICE_SAMPLES): SmmPost[] {
  const accepted = store.acceptedPosts(CANDIDATES);
  const scored = accepted.map((post) => ({ post, score: metricsScore(post.metrics) }));
  const bar = median(scored.filter((item) => item.score > 0).map((item) => item.score));
  const counts = ({ post, score }: { post: SmmPost; score: number }): boolean => {
    if (post.origin === OWNER_POST_ORIGIN) return true;
    if (score <= 0) return false;
    return post.origin !== SCHEDULE_ORIGIN || score >= bar;
  };
  return scored
    .filter(counts)
    .sort(
      (a, b) =>
        Number(b.post.origin === OWNER_POST_ORIGIN) - Number(a.post.origin === OWNER_POST_ORIGIN) ||
        b.score - a.score ||
        b.post.createdMs - a.post.createdMs,
    )
    .slice(0, limit)
    .map((item) => item.post);
}

export function voiceBlock(samples: readonly SmmPost[]): string {
  return samples
    .map((post, index) => {
      const metrics = post.metrics ? ` (цифры: ${post.metrics})` : '';
      return `Пост ${index + 1}${metrics}:\n${post.parts.join('\n\n').slice(0, SAMPLE_MAX_CHARS)}`;
    })
    .join('\n\n---\n\n');
}
