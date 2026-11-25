import {
  isCandidateStatusId,
  TARGET_PROFESSION_MAX_LENGTH,
  type CandidateStatusId,
  type CandidateStatusPreview,
  type CandidateStatusState,
  type StatusChangeOptionKey,
} from '../../../../shared/candidateStatus';
import { dropSectionCache, SECTION_CACHE_KEYS } from '../../shell/sectionCache';
import { apiFetch, readData } from '../../coach/apiClient';

const STATUS_API = '/api/v1/candidate/status';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Что выбрано на экране: статус и новая профессия (для «Меняю профессию»). */
export interface StatusChoice {
  readonly status: CandidateStatusId;
  readonly targetProfession: string;
}

export type StatusOptions = Readonly<Partial<Record<StatusChangeOptionKey, boolean>>>;

interface ChoiceBody {
  readonly status: CandidateStatusId;
  readonly targetProfession?: string;
}

function cleanProfession(value: string): string {
  return value
    .replace(/[\p{Cc}\p{Cf}\s]+/gu, ' ')
    .trim()
    .slice(0, TARGET_PROFESSION_MAX_LENGTH);
}

/** Тело запроса: профессия уходит только вместе с «Меняю профессию». */
export function choiceBody(choice: StatusChoice): ChoiceBody {
  const profession =
    choice.status === 'changing_profession' ? cleanProfession(choice.targetProfession) : '';
  return profession
    ? { status: choice.status, targetProfession: profession }
    : { status: choice.status };
}

export async function getStatus(signal?: AbortSignal): Promise<CandidateStatusState> {
  const response = await apiFetch(STATUS_API, { signal });
  return readData<CandidateStatusState>(response);
}

/** «Что изменится» при выбранном статусе; ничего не сохраняет. */
export async function previewStatus(
  choice: StatusChoice,
  signal?: AbortSignal,
): Promise<CandidateStatusPreview> {
  const response = await apiFetch(`${STATUS_API}/preview`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(choiceBody(choice)),
    signal,
  });
  const data = await readData<{ readonly preview: CandidateStatusPreview }>(response);
  return data.preview;
}

export async function changeStatus(
  choice: StatusChoice,
  options: StatusOptions,
): Promise<CandidateStatusState> {
  const response = await apiFetch(STATUS_API, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ ...choiceBody(choice), options }),
  });
  dropSectionCache(SECTION_CACHE_KEYS.careerStatus);
  return readData<CandidateStatusState>(response);
}

/**
 * С чего начинает экран: предложение из адреса (`?status=&profession=` от
 * сигнала на «Сегодня»), если статус из списка, иначе нынешний статус.
 * Значения адреса — чужой ввод: статус сверяем со списком, профессию чистим.
 */
export function initialChoice(search: string, state: CandidateStatusState): StatusChoice {
  const query = new URLSearchParams(search);
  const suggested = query.get('status');
  if (isCandidateStatusId(suggested)) {
    const profession = suggested === 'changing_profession' ? (query.get('profession') ?? '') : '';
    return { status: suggested, targetProfession: cleanProfession(profession) };
  }
  return {
    status: state.current.status,
    targetProfession: state.current.targetProfession ?? '',
  };
}

/** Выбран тот же статус с той же профессией: кнопки «Сменить статус» нет. */
export function sameChoice(choice: StatusChoice, state: CandidateStatusState): boolean {
  const body = choiceBody(choice);
  return (
    body.status === state.current.status &&
    (body.targetProfession ?? '') === (state.current.targetProfession ?? '')
  );
}
