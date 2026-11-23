import { apiFetch, readData } from '../../coach/apiClient';

/** B744: подсказки формы цели (d02b, d02c). Всё под флагом B640. */
const ROOT = '/api/v1/candidate/career-diary';

export interface GoalExample {
  readonly title: string;
  readonly measure: string;
}

export interface GoalBaseline {
  readonly value: number;
  readonly quote: string;
  /** `ГГГГ-ММ-ДД` записи, откуда цитата. */
  readonly entryDate: string;
}

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

async function post(path: string, body: unknown): Promise<unknown> {
  return readData<unknown>(
    await apiFetch(`${ROOT}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

/** `null` — примеров под роль нет: экран показывает общие. */
export async function getGoalExamples(role: string): Promise<readonly GoalExample[] | null> {
  const data = (await post('goal-examples', { role })) as { items?: unknown } | null;
  const items = Array.isArray(data?.items) ? data.items : [];
  const valid = items.filter(
    (item): item is GoalExample =>
      !!item && isText((item as GoalExample).title) && isText((item as GoalExample).measure),
  );
  return valid.length > 0 ? valid : null;
}

/** `null` — значения в записях нет. */
export async function getGoalBaseline(indicator: string): Promise<GoalBaseline | null> {
  const data = (await post('goal-baseline', { indicator })) as Partial<GoalBaseline> | null;
  if (!data || typeof data.value !== 'number' || !Number.isFinite(data.value)) return null;
  if (!isText(data.quote) || !/^\d{4}-\d{2}-\d{2}$/u.test(String(data.entryDate))) return null;
  return { value: data.value, quote: data.quote, entryDate: String(data.entryDate) };
}

/** Русское название роли для текста d02c, как на «Карьере»; `null` — русского нет. */
export async function getRoleTitleRu(title: string): Promise<string | null> {
  const data = await readData<{ titleRu?: unknown } | null>(
    await apiFetch(`${ROOT}/role-title-ru?title=${encodeURIComponent(title)}`),
  );
  const resolved = data?.titleRu;
  return isText(resolved) ? resolved : null;
}
