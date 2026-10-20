import { apiFetch, readData } from '../coach/apiClient';

/** Кого называет напоминание: свой контакт кандидата или рекрутер вакансии (B542). */
export interface ApplicationContact {
  readonly name: string;
  readonly source: 'candidate' | 'vacancy';
}

function contactUrl(applicationId: string): string {
  return `/api/v1/candidate/applications/${encodeURIComponent(applicationId)}/contact`;
}

export async function getApplicationContact(
  applicationId: string,
): Promise<ApplicationContact | null> {
  return readData<ApplicationContact | null>(await apiFetch(contactUrl(applicationId)));
}

/** Пустое имя убирает свой контакт: снова действует рекрутер вакансии, если он есть. */
export async function saveApplicationContact(
  applicationId: string,
  name: string | null,
): Promise<ApplicationContact | null> {
  await readData<unknown>(
    await apiFetch(contactUrl(applicationId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  );
  return getApplicationContact(applicationId);
}
