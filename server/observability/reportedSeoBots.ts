import type { FastifyInstance } from 'fastify';

const BOT_NAMES = [
  'YandexBot', 'YandexAdditional', 'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
  'Google-Extended', 'Googlebot', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User',
  'PerplexityBot',
] as const;
const BOT_PATTERNS = BOT_NAMES.map((name) => ({ name, pattern: new RegExp(`(?:^|[^a-z0-9_-])${name}(?=$|[^a-z0-9_-])`, 'i') }));
const STATIC_SURFACES = new Map([
  ['/', 'home'], ['/faq', 'faq'], ['/support', 'support'],
  ['/tools/country-fit', 'country_fit'], ['/tools/relocation', 'relocation'], ['/tools/resume', 'resume_builder'], ['/legal/terms', 'legal_terms'],
  ['/legal/privacy', 'legal_privacy'], ['/legal/consent', 'legal_consent'],
  ['/legal/disclaimer', 'legal_disclaimer'], ['/robots.txt', 'robots'],
  ['/llms.txt', 'llms'], ['/llms-full.txt', 'llms_full'],
  ['/sitemap.xml', 'sitemap'], ['/vacancies', 'vacancy_directory'], ['/salaries', 'salary_directory'],
]);
const MAX_BUCKETS = 256;
const INTERVAL_MS = 5 * 60 * 1_000;

type Bot = typeof BOT_NAMES[number] | 'ambiguous';
type Bucket = { bot: Bot; surface: string; status: string; count: number };

/** UA is only a client assertion, never verification of a vendor's crawler. */
export function reportedBot(userAgent: string | undefined): Bot | null {
  if (!userAgent || userAgent.length > 2_048) return null;
  const matches = BOT_PATTERNS.filter(({ pattern }) => pattern.test(userAgent));
  return matches.length > 1 ? 'ambiguous' : matches[0]?.name ?? null;
}

export function seoSurface(url: string): string | null {
  // No URL or query is retained. Reject oversized / non-origin-form inputs.
  if (url.length > 8_192 || !url.startsWith('/') || url.startsWith('//')) return null;
  const path = url.split('?', 1)[0];
  const fixed = STATIC_SURFACES.get(path);
  if (fixed) return fixed;
  if (/^\/sitemaps\/[a-z0-9-]+\.xml$/u.test(path)) return 'sitemap_shard';
  if (/^\/vacancies\/job\/[a-z0-9-]+$/u.test(path)) return 'vacancy_job';
  if (/^\/vacancies\/[a-z0-9-]+\/[a-z0-9-]+$/u.test(path)) return 'vacancy_city_role';
  if (/^\/vacancies\/[a-z0-9-]+$/u.test(path)) return 'vacancy_city';
  if (/^\/salaries\/[a-z0-9-]+$/u.test(path)) return 'salary_role';
  return null;
}

function statusBucket(status: number): string {
  if (status === 200 || status === 502) return String(status);
  if (status >= 200 && status < 600) return `${Math.floor(status / 100)}xx`;
  return 'other';
}

export function registerReportedSeoBotObservability(app: FastifyInstance): void {
  const buckets = new Map<string, Bucket>();
  let overflow = 0;
  let startedAt = new Date().toISOString();
  const flush = (partial: boolean) => {
    if (buckets.size || overflow) {
      app.log.info({
        event: 'seo_reported_bot_responses',
        identity: 'reported_user_agent_unverified',
        startedAt, endedAt: new Date().toISOString(), partial,
        complete: overflow === 0, overflowResponses: overflow,
        buckets: [...buckets.values()],
      }, 'Aggregate responses for reported crawler user agents');
    }
    buckets.clear();
    overflow = 0;
    startedAt = new Date().toISOString();
  };
  app.addHook('onResponse', async (request, reply) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return;
    const bot = reportedBot(request.headers['user-agent']);
    if (!bot) return;
    const surface = seoSurface(request.url);
    if (!surface) return;
    const status = statusBucket(reply.statusCode);
    const key = `${bot}:${surface}:${status}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.count += 1;
    else if (buckets.size < MAX_BUCKETS) buckets.set(key, { bot, surface, status, count: 1 });
    else overflow += 1;
  });
  const timer = setInterval(() => flush(false), INTERVAL_MS);
  timer.unref();
  app.addHook('onClose', async () => {
    clearInterval(timer);
    flush(true);
  });
}
