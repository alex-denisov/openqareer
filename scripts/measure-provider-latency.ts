/**
 * B185 — замер реального времени ответа каждой настроенной модели.
 *
 * Требование владельца (2026-09-03): «нужно проверить, за какое реальное время
 * отвечают все модели максимально простым запросом с минимальным количеством
 * токенов, а затем уже с более реальными данными… возможно, сам транспорт
 * как-то мешает получить ответ быстро».
 *
 * Инструмент ходит теми же коннекторами, что и прод (`buildCoachProvider`), а
 * не собственным HTTP-клиентом: замер по отдельному клиенту измерял бы не то,
 * что работает в проде — ни схему ответа, ни бюджет рассуждения, ни тоннель
 * Cloudflare у Gemini.
 *
 * Две пробы:
 *   empty — минимально допустимый ход: одно короткое сообщение, без контекста
 *           знаний и наблюдений рынка. Это пол: транспорт, очередь провайдера
 *           и стоимость рассуждения на пустом входе.
 *   real  — ход, близкий к продовому по размеру входа: резюме, подтверждённые
 *           факты, открытые вопросы и наблюдения рынка. Данные синтетические.
 *
 * Ни один персональный факт владельца сюда не попадает: `dataClass` —
 * `synthetic`, содержимое выдумано.
 *
 * `--models` обязателен: инструмент никогда не ходит по каталогу целиком.
 *
 *   npx tsx scripts/measure-provider-latency.ts --models=<id>[,<id>…]
 *                                               [--probe=empty|real|both]
 *                                               [--repeat=1] [--timeout=180]
 *                                               [--only=openai,gemini]
 *                                               [--models=gpt-5.6-luna,...]
 */
import { readFileSync } from 'node:fs';
import type { CoachTurnInput } from '../server/domain/coach';
import { readCloudflareGatewayConfig } from '../server/providers/cloudflareAiGateway';
import { buildCoachProvider } from '../server/providers/coachProviderFactory';
import {
  allowedModels,
  modelRegistry,
  PROVIDER_IDS,
  type ProviderId,
} from '../server/providers/modelRegistry';
import { resolveLocalEnvironmentFilePath } from '../server/localEnvironmentFile';

type ProbeName = 'empty' | 'real';

function argument(name: string, fallback: string): string {
  const found = process.argv.find((item) => item.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}

/** Файл секретов читается тем же способом, что и в остальных скриптах. */
function readEnvironmentFile(): NodeJS.ProcessEnv {
  const path = resolveLocalEnvironmentFilePath();
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    return { ...process.env };
  }
  const parsed: Record<string, string> = {};
  for (const line of contents.split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^(['"])(.*)\1$/u, '$2');
    parsed[match[1]] = value;
  }
  return { ...parsed, ...process.env };
}

function emptyTurn(): CoachTurnInput {
  return {
    candidateReference: 'measure-b185',
    dataClass: 'synthetic',
    locale: 'ru-RU',
    phase: 'discovery',
    messages: [{ id: 'm1', role: 'user', content: 'Здравствуйте.' }],
    activeRole: 'career_expert',
  };
}

const RESUME_EXCERPT = [
  'Опыт работы, синтетическое резюме для замера задержек.',
  ...Array.from({ length: 40 }, (_, index) =>
    `${2016 + (index % 9)} — компания «Пример ${index + 1}»: отвечал за поставку ` +
    'внутреннего продукта, вёл команду из шести человек, согласовывал требования ' +
    'со смежными подразделениями, отвечал за сроки и качество релизов, готовил ' +
    'отчётность для руководства и защищал бюджет направления на год вперёд.',
  ),
].join('\n');

const uuid = (index: number) =>
  `0000${index.toString(16).padStart(4, '0')}-0000-4000-8000-000000000000`.slice(-36);

function realMessages(): CoachTurnInput['messages'] {
  return [
    {
      id: 'm1',
      role: 'user',
      content:
        'Я не уверен, как называется моя роль. Последние девять лет я вёл ' +
        'внутренние продукты, но в трудовой я «руководитель отдела». ' +
        'Помогите понять, что искать на рынке.',
    },
    {
      id: 'm2',
      role: 'assistant',
      content:
        'Давайте разберём по фактам: что именно вы решали сами, а что ' +
        'согласовывали, и какие результаты можно подтвердить.',
    },
    { id: 'm3', role: 'user', content: RESUME_EXCERPT.slice(0, 7_500) },
  ];
}

function realKnowledgeContext(): NonNullable<CoachTurnInput['knowledgeContext']> {
  return {
    confirmedFacts: Array.from({ length: 12 }, (_, index) => ({
      ref: `memory:${uuid(index + 1)}`,
      kind: 'fact' as const,
      domain: 'responsibility' as const,
      statement:
        `Факт ${index + 1}: кандидат отвечал за направление и подтверждает ` +
        'это документом; формулировка синтетическая и нужна только для замера ' +
        'размера входа, чтобы проба совпадала с продовым ходом по объёму.',
      sourceRefs: [`document:${uuid(900 + index)}`],
      sensitive: false,
    })),
    documents: [
      {
        ref: `document:${uuid(901)}`,
        kind: 'resume' as const,
        fileName: 'resume-synthetic.pdf',
        version: 1,
        sha256: 'a'.repeat(64),
        excerpt: RESUME_EXCERPT.slice(0, 6_000),
      },
      {
        ref: `document:${uuid(902)}`,
        kind: 'profile_export' as const,
        fileName: 'profile-synthetic.json',
        version: 1,
        sha256: 'b'.repeat(64),
        excerpt: RESUME_EXCERPT.slice(0, 6_000),
      },
    ],
    openQuestions: Array.from({ length: 12 }, (_, index) => ({
      ref: `memory:${uuid(index + 500)}`,
      statement:
        `Открытый вопрос ${index + 1}: чем подтверждается участие кандидата ` +
        'в решении, и кто ещё влиял на результат в этом периоде?',
      sourceRefs: [],
    })),
  };
}

function realMarketObservations(): NonNullable<CoachTurnInput['marketObservations']> {
  return Array.from({ length: 20 }, (_, index) => ({
    ref: `market:hh:${100000 + index}`,
    source: 'hh' as const,
    title: `Руководитель направления ${index + 1}`,
    company: `Компания ${index + 1}`,
    location: 'Москва',
    sourceUrl: `https://hh.ru/vacancy/${100000 + index}`,
    observedAt: '2026-09-01T00:00:00.000Z',
  }));
}

function realTurn(): CoachTurnInput {
  return {
    candidateReference: 'measure-b185',
    dataClass: 'synthetic',
    locale: 'ru-RU',
    phase: 'role',
    messages: realMessages(),
    knowledgeContext: realKnowledgeContext(),
    marketObservations: realMarketObservations(),
    activeRole: 'career_expert',
  };
}

interface Measurement {
  provider: ProviderId;
  model: string;
  probe: ProbeName;
  attempt: number;
  ms: number;
  outcome: 'ok' | 'failed' | 'timeout';
  code?: string;
  diagnostic?: string;
  inputTokens?: number;
  outputTokens?: number;
  servedModel?: string;
}

function providerFor(
  provider: ProviderId,
  model: string,
  environment: NodeJS.ProcessEnv,
) {
  const definition = modelRegistry[provider];
  return buildCoachProvider({
    provider,
    apiKey: environment[definition.credentialEnvironment[0]] ?? '',
    model,
    ...(provider === 'yandex'
      ? { folderId: environment.OPENQAREER_YANDEX_FOLDER_ID ?? '' }
      : {}),
    ...(provider === 'gemini'
      ? { cloudflareGateway: readCloudflareGatewayConfig(environment) }
      : {}),
  });
}

function failureOf(error: unknown): Pick<Measurement, 'outcome' | 'code' | 'diagnostic'> {
  const message = error instanceof Error ? error.message : String(error);
  if (message === TIMEOUT_MARKER) return { outcome: 'timeout' };
  const code =
    typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : message.slice(0, 120);
  const diagnostic = (error as { diagnostic?: string }).diagnostic;
  return { outcome: 'failed', code, ...(diagnostic ? { diagnostic } : {}) };
}

const TIMEOUT_MARKER = '__b185_timeout__';

async function measure(
  provider: ProviderId,
  model: string,
  probe: ProbeName,
  attempt: number,
  environment: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<Measurement> {
  const coach = providerFor(provider, model, environment);
  const input = probe === 'empty' ? emptyTurn() : realTurn();
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const head = { provider, model, probe, attempt };
  try {
    const call = coach.createTurn(input, `b185-${provider}-${probe}-${attempt}`);
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(TIMEOUT_MARKER)), timeoutMs).unref();
    });
    const result = await Promise.race([call, timeout]);
    return {
      ...head,
      ms: elapsed(),
      outcome: 'ok',
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      servedModel: result.model,
    };
  } catch (error) {
    return { ...head, ms: elapsed(), ...failureOf(error) };
  }
}

const environment = readEnvironmentFile();
const probeArgument = argument('probe', 'both');
const probes: ProbeName[] =
  probeArgument === 'both' ? ['empty', 'real'] : [probeArgument as ProbeName];
const repeat = Number.parseInt(argument('repeat', '1'), 10);
const timeoutMs = Number.parseInt(argument('timeout', '180'), 10) * 1_000;
const only = argument('only', '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
/**
 * Отбор по модели, а не по провайдеру: очередь состоит из моделей (B183).
 *
 * Список обязателен и инструмент без него отказывает. Первый прогон 2026-09-03
 * шёл по всему каталогу и задел платные модели, которых владелец не называл, —
 * замер обязан быть закрытым по умолчанию, как и всё остальное в этом
 * продукте: тратит деньги только то, что названо вслух.
 */
const onlyModels = argument('models', '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
if (onlyModels.length === 0) {
  process.stderr.write(
    '--models is required: name every model to measure, comma separated.\n' +
      'A catalogue-wide run would call models nobody asked for, and paid ones cost money.\n',
  );
  process.exit(2);
}

const gateway = readCloudflareGatewayConfig(environment);
const results: Measurement[] = [];
const skipped: Array<{ provider: ProviderId; reason: string }> = [];

for (const provider of PROVIDER_IDS) {
  if (only.length > 0 && !only.includes(provider)) continue;
  const definition = modelRegistry[provider];
  const configured = definition.credentialEnvironment.every((name) =>
    Boolean(environment[name]?.trim()),
  );
  if (!configured) {
    skipped.push({ provider, reason: 'no-credentials' });
    continue;
  }
  if (provider === 'gemini' && !gateway) {
    skipped.push({ provider, reason: 'no-cloudflare-gateway' });
    continue;
  }
  const models = allowedModels(provider);
  if (models.length === 0) {
    skipped.push({ provider, reason: 'no-cutoff-safe-model' });
    continue;
  }
  for (const model of models) {
    if (onlyModels.length > 0 && !onlyModels.includes(model.id)) continue;
    for (const probe of probes) {
      for (let attempt = 1; attempt <= repeat; attempt += 1) {
        const measurement = await measure(
          provider,
          model.id,
          probe,
          attempt,
          environment,
          timeoutMs,
        );
        results.push(measurement);
        process.stdout.write(`${JSON.stringify(measurement)}\n`);
      }
    }
  }
}

process.stdout.write(
  `\n${JSON.stringify({ skipped, measuredAt: new Date().toISOString() })}\n`,
);
