import type { HhResumeItem } from '../../connections/hhSessionPoll';
import type { NativeImportMode } from '../../resume/resumeApi';
import type { ParsedResume } from '../../workspace/resumeParser';

/**
 * n03, строка hh.ru в приложении: «Обновить сейчас» и «Сменить резюме».
 * Оба действия читают резюме в сессии кандидата hh.ru (окно приложения), как при подключении;
 * код сессии грузится только по нажатию, чтобы не утяжелять раздел.
 */

export type HhListRead =
  | { readonly kind: 'signin' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'ready'; readonly resumes: readonly HhResumeItem[] };

/** Список резюме кандидата на hh.ru и то, которым он откликается сейчас. */
export async function readHhResumeList(): Promise<
  HhListRead & { readonly selectedId: string | null }
> {
  const [{ readHhResumes }, { getHhResumes }] = await Promise.all([
    import('../apply/hh/hhDesktop'),
    import('../apply/hh/hhSessionApi'),
  ]);
  const [read, snapshot] = await Promise.all([readHhResumes(), getHhResumes().catch(() => null)]);
  const selectedId = snapshot?.selected?.id ?? null;
  if (read.kind === 'signed_out') return { kind: 'signin', selectedId };
  return read.kind === 'empty' ? { kind: 'empty', selectedId } : { ...read, selectedId };
}

/** B710: выбранное резюме — то, которым уходят отклики; список сохраняется вместе с ним. */
export async function chooseHhResume(
  resumes: readonly HhResumeItem[],
  chosen: HhResumeItem,
): Promise<void> {
  const [{ readHhResumeContent, summaryOf }, { saveHhResumes }] = await Promise.all([
    import('../apply/hh/hhDesktop'),
    import('../apply/hh/hhSessionApi'),
  ]);
  const content = await readHhResumeContent(chosen);
  await saveHhResumes(resumes.map(summaryOf), content);
}

/** Профиль из резюме hh.ru заново: выбранное резюме, а без выбора — первое в списке. */
export async function refreshHhProfile(
  resumes: readonly HhResumeItem[],
  selectedId: string | null,
): Promise<void> {
  const item = resumes.find((resume) => resume.id === selectedId) ?? resumes[0];
  if (!item) throw new Error('hh_resume_not_read');
  const [{ readHhResumeFromSession }, { readSessionPage }, { persistHhSessionImport }] =
    await Promise.all([
      import('../../connections/hhSessionPoll'),
      import('../../connections/connectorSession'),
      import('../../connections/AccountConnections'),
    ]);
  const parsed = await readHhResumeFromSession(item.url, (url) => readSessionPage('hh', url));
  if (!parsed) throw new Error('hh_resume_not_read');
  await persistHhSessionImport({
    parsed,
    sourceUrl: item.url,
    capturedAt: new Date().toISOString(),
  });
}

/** a11b → n03: резюме, прочитанное окном подключения, сохраняется с профилем или только подключением. */
export async function connectHhFromSession(
  parsed: ParsedResume,
  sourceUrl: string,
  importMode: NativeImportMode | null,
): Promise<void> {
  const { persistHhSessionImport } = await import('../../connections/AccountConnections');
  await persistHhSessionImport({
    parsed,
    sourceUrl,
    capturedAt: new Date().toISOString(),
    ...(importMode ? { importMode } : {}),
  });
}
