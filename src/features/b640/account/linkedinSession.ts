/**
 * n03, строка LinkedIn в приложении: «Обновить сейчас» — тот же фоновый импорт профиля,
 * что «Импортировать заново» в профиле; окно LinkedIn показывается, только если нужен вход.
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
