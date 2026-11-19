import { apiFetch, readData } from '../../../coach/apiClient';
import type {
  LinkedinProfileView,
  LinkedinSection,
  LinkedinSectionCurrent,
} from '../../../../../shared/b640LinkedinProfile';

const BASE = '/api/v1/candidate/b640/linkedin/profile';

export interface SectionMarks {
  readonly copiedAt: string | null;
  readonly pastedAt: string | null;
}

const send = (method: 'PUT' | 'POST', body: unknown = {}) =>
  ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) satisfies RequestInit;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  return readData<T>(await apiFetch(url, init));
}

/** Все четыре раздела: «сейчас», предложение, отметки «скопировано» и «вставлено». */
export const getLinkedinProfile = () => call<LinkedinProfileView>(BASE);

/** Вставленный кандидатом текущий текст раздела; на LinkedIn ничего не уходит. */
export const saveSectionCurrent = (section: LinkedinSection, text: string) =>
  call<LinkedinSectionCurrent>(`${BASE}/${section}/current`, send('PUT', { text }));

export const markSectionCopied = (section: LinkedinSection) =>
  call<SectionMarks>(`${BASE}/${section}/copied`, send('POST'));

export const markSectionPasted = (section: LinkedinSection) =>
  call<SectionMarks>(`${BASE}/${section}/pasted`, send('POST'));
