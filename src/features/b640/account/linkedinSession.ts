/**
 * n03, строка LinkedIn в приложении: «Обновить сейчас» — тот же фоновый импорт профиля,
 * что «Импортировать заново» в профиле; окно LinkedIn открывает кандидат, когда нужен вход.
 * Код сессии грузится по нажатию.
 */
export interface LinkedInRefreshOutcome {
  readonly ok: boolean;
  /** Что сказать кандидату: сколько сохранено или почему не вышло. */
  readonly message: string;
}

export async function refreshLinkedInProfile(): Promise<LinkedInRefreshOutcome> {
  const [{ startLinkedInBackgroundImport }, { nativeImportNotice, persistLinkedInCapture }] =
    await Promise.all([
      import('../../connections/linkedinBackgroundImport'),
      import('../../connections/AccountConnections'),
    ]);
  const outcome = await startLinkedInBackgroundImport(async (capture) =>
    nativeImportNotice('linkedin', await persistLinkedInCapture(capture)),
  );
  return { ok: outcome.phase === 'done', message: outcome.message };
}

/** Окно LinkedIn ждёт кандидата: вход, код или проверка. */
export async function watchLinkedInNeedsPerson(
  onChange: (needed: boolean) => void,
): Promise<() => void> {
  const { subscribeLinkedInBackgroundImport } = await import(
    '../../connections/linkedinBackgroundImport'
  );
  return subscribeLinkedInBackgroundImport((state) => onChange(state.phase === 'needs_person'));
}

export async function showLinkedInWindow(): Promise<void> {
  const { showLinkedInImportWindow } = await import('../../connections/linkedinBackgroundImport');
  await showLinkedInImportWindow();
}
