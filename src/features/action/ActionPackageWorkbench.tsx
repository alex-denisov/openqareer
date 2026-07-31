import { useMemo, useState } from 'react';
import type { CandidateWorkspace } from '../workspace/workspaceStorage';
import {
  composeActionPackageMarkdown,
  composeMessage,
  composeResumeMarkdown,
  getActionChecklist,
  getActionPackageIssues,
  updateActionPackage,
  type ActionPackage,
} from './actionPackageEngine';

interface ActionPackageWorkbenchProps {
  workspace: CandidateWorkspace;
  actionPackage: ActionPackage;
  storageError?: string;
  onBack: () => void;
  onChange: (actionPackage: ActionPackage) => void;
}

type CopyState = 'idle' | 'copied' | 'error';

export function ActionPackageWorkbench({
  workspace,
  actionPackage,
  storageError,
  onBack,
  onChange,
}: ActionPackageWorkbenchProps) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const resumePreview = useMemo(
    () => composeResumeMarkdown(actionPackage),
    [actionPackage],
  );
  const messagePreview = useMemo(
    () => composeMessage(actionPackage),
    [actionPackage],
  );
  const issues = getActionPackageIssues(actionPackage);
  const checklist = getActionChecklist(actionPackage.decisionChoice);
  const selectedIds = new Set(actionPackage.selectedEvidenceIds);
  const completedIds = new Set(actionPackage.completedChecklistIds);

  function update(
    patch: Parameters<typeof updateActionPackage>[1],
  ): void {
    onChange(updateActionPackage(actionPackage, patch));
    setCopyState('idle');
  }

  function toggleEvidence(id: string): void {
    update({
      selectedEvidenceIds: selectedIds.has(id)
        ? actionPackage.selectedEvidenceIds.filter((item) => item !== id)
        : [...actionPackage.selectedEvidenceIds, id],
    });
  }

  function toggleChecklist(id: string): void {
    update({
      completedChecklistIds: completedIds.has(id)
        ? actionPackage.completedChecklistIds.filter((item) => item !== id)
        : [...actionPackage.completedChecklistIds, id],
    });
  }

  async function copyPackage(): Promise<void> {
    try {
      const reviewedAt = new Date().toISOString();
      const reviewed = updateActionPackage(actionPackage, { reviewedAt });
      await navigator.clipboard.writeText(
        composeActionPackageMarkdown(reviewed),
      );
      onChange(reviewed);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  }

  function downloadPackage(): void {
    const reviewed = updateActionPackage(actionPackage, {
      reviewedAt: new Date().toISOString(),
    });
    const content = composeActionPackageMarkdown(reviewed);
    const blob = new Blob([content], {
      type: 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = buildFileName(
      actionPackage.roleTitle,
      actionPackage.company,
    );
    anchor.click();
    URL.revokeObjectURL(url);
    onChange(reviewed);
  }

  return (
    <main className="action-layout" data-testid="action-package-workbench">
      <header className="action-header">
        <button className="text-button" onClick={onBack}>
          ← Решение по вакансии
        </button>
        <div>
          <p className="eyebrow">Пакет действия · локально</p>
          <h1>Из решения — в готовый следующий шаг.</h1>
          <p>
            Мы не переписываем вашу историю. Вы выбираете подтверждённые факты,
            добавляете личную мотивацию и получаете материал для официального
            интерфейса площадки.
          </p>
        </div>
      </header>

      {storageError ? (
        <div className="status-message status-message--error" role="alert">
          <strong>Изменения остались на экране, но не сохранились.</strong>
          <p>{storageError}</p>
        </div>
      ) : null}

      <section className="action-brief" aria-label="Контекст пакета">
        <div>
          <p className="eyebrow">
            {actionPackage.decisionChoice === 'apply'
              ? 'Отклик'
              : 'Контакт'}
          </p>
          <h2>{actionPackage.roleTitle}</h2>
          <p>{actionPackage.company || 'Компания не указана'}</p>
        </div>
        <dl>
          <div>
            <dt>Фактов выбрано</dt>
            <dd>
              {actionPackage.selectedEvidenceIds.length}/
              {actionPackage.citations.length}
            </dd>
          </div>
          <div>
            <dt>Нужно уточнить</dt>
            <dd aria-live="polite">{issues.length}</dd>
          </div>
          <div>
            <dt>Данные</dt>
            <dd>Только в браузере</dd>
          </div>
        </dl>
      </section>

      <div className="action-editor-grid">
        <section className="action-editor">
          <div className="section-heading">
            <div>
              <p className="eyebrow">01 · Акценты резюме</p>
              <h2>Что вынести наверх</h2>
            </div>
            <span>Факты нельзя придумать</span>
          </div>

          <div className="field action-positioning-field">
            <label htmlFor="action-positioning">Строка позиционирования</label>
            <input
              id="action-positioning"
              value={actionPackage.positioningLine}
              maxLength={140}
              onChange={(event) =>
                update({ positioningLine: event.target.value })
              }
            />
            <p className="field-help">
              Это интерпретация, а не должность из трудовой книжки. Проверьте
              формулировку перед использованием.
            </p>
          </div>

          <fieldset className="evidence-selector">
            <legend>Подтверждённые факты</legend>
            <p>
              Выберите только те тезисы, которые важны для этой вакансии.
            </p>
            <div>
              {actionPackage.citations.map((citation) => (
                <label
                  key={citation.evidenceId}
                  className={
                    selectedIds.has(citation.evidenceId)
                      ? 'evidence-option is-selected'
                      : 'evidence-option'
                  }
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(citation.evidenceId)}
                    onChange={() => toggleEvidence(citation.evidenceId)}
                  />
                  <span className="evidence-check" aria-hidden="true">
                    {selectedIds.has(citation.evidenceId) ? '✓' : ''}
                  </span>
                  <span>
                    <strong>{citation.statement}</strong>
                    <small>
                      {citation.opportunityItemIds.length > 0
                        ? `Связано с ${citation.opportunityItemIds.join(', ')}`
                        : 'Прямое совпадение не найдено'}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        <aside className="action-preview">
          <div className="preview-heading">
            <div>
              <p className="eyebrow">Предпросмотр</p>
              <h2>Адаптация резюме</h2>
            </div>
            <span>Markdown</span>
          </div>
          <pre>{resumePreview}</pre>
          <p className="preview-note">
            Исходный PDF не меняется. Этот блок — карта акцентов для его
            адаптации.
          </p>
        </aside>
      </div>

      <div className="action-message-grid">
        <section className="message-editor">
          <p className="eyebrow">02 · Личный контекст</p>
          <h2>
            {actionPackage.decisionChoice === 'apply'
              ? 'Почему именно эта роль'
              : 'Зачем вы пишете этому человеку'}
          </h2>
          <div className="field">
            <label htmlFor="action-motivation">Одно конкретное предложение</label>
            <textarea
              id="action-motivation"
              value={actionPackage.motivationNote}
              maxLength={360}
              onChange={(event) =>
                update({ motivationNote: event.target.value })
              }
              placeholder={
                actionPackage.decisionChoice === 'apply'
                  ? 'Например: мне близка задача вывести продукт на новый рынок…'
                  : 'Например: хочу понять, как команда измеряет успех этой роли…'
              }
            />
            <p className="field-help">
              {actionPackage.motivationNote.length}/360 · Это ваша субъективная
              мотивация; сервис не выдаёт её за подтверждённый факт.
            </p>
          </div>
        </section>

        <section className="message-preview">
          <div className="preview-heading">
            <div>
              <p className="eyebrow">Готовый текст</p>
              <h2>
                {actionPackage.decisionChoice === 'apply'
                  ? 'Сопроводительное сообщение'
                  : 'Первое сообщение'}
              </h2>
            </div>
          </div>
          <pre>{messagePreview}</pre>
        </section>
      </div>

      <section className="action-sources">
        <div className="section-heading">
          <div>
            <p className="eyebrow">03 · Проверка происхождения</p>
            <h2>Откуда взят каждый факт</h2>
          </div>
          <span>{actionPackage.methodVersion}</span>
        </div>
        <div className="source-ledger">
          {actionPackage.citations
            .filter((citation) => selectedIds.has(citation.evidenceId))
            .map((citation) => (
              <article key={citation.evidenceId}>
                <span>{citation.evidenceId.toUpperCase()}</span>
                <div>
                  <strong>{citation.statement}</strong>
                  <p>Источник в резюме: «{citation.sourceExcerpt}»</p>
                </div>
              </article>
            ))}
          {actionPackage.selectedEvidenceIds.length === 0 ? (
            <p className="empty-ledger">
              Выберите факт выше — здесь появится его источник.
            </p>
          ) : null}
        </div>
      </section>

      <section className="action-checklist">
        <div aria-live="polite">
          <p className="eyebrow">04 · Перед действием</p>
          <h2>Короткий контрольный список</h2>
          <p>
            Сервис ничего не отправляет и не открывает от вашего имени.
          </p>
        </div>
        <div className="checklist-items">
          {checklist.map((item) => (
            <label
              key={item.id}
              className={completedIds.has(item.id) ? 'is-complete' : ''}
            >
              <input
                type="checkbox"
                checked={completedIds.has(item.id)}
                onChange={() => toggleChecklist(item.id)}
              />
              <span aria-hidden="true">
                {completedIds.has(item.id) ? '✓' : ''}
              </span>
              <span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
            </label>
          ))}
        </div>
      </section>

      <footer className="action-footer">
        <div>
          {issues.length > 0 ? (
            <>
              <p className="eyebrow">Перед использованием</p>
              <ul>
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="action-ready">
              Факты выбраны, личный контекст добавлен. Можно проверить итог.
            </p>
          )}
        </div>
        <div className="action-buttons">
          <button className="button button--secondary" onClick={downloadPackage}>
            Скачать .md
          </button>
          <button className="button button--primary" onClick={copyPackage}>
            <span aria-live="polite">
              {copyState === 'copied'
                ? 'Скопировано'
                : copyState === 'error'
                  ? 'Не удалось скопировать'
                  : 'Скопировать пакет'}
            </span>
          </button>
          {actionPackage.sourceUrl ? (
            <a
              className="button action-native-link"
              href={actionPackage.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              Открыть источник ↗
            </a>
          ) : null}
        </div>
        {copyState === 'error' ? (
          <p className="copy-error" role="alert">
            Браузер запретил доступ к буферу. Скачайте пакет файлом.
          </p>
        ) : null}
      </footer>
    </main>
  );
}

function buildFileName(roleTitle: string, company: string): string {
  const safe = `${roleTitle}-${company || 'company'}`
    .toLocaleLowerCase('ru-RU')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 72);
  return `action-package-${safe || 'opportunity'}.md`;
}
