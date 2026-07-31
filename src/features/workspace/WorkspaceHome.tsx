import { useState } from 'react';
import type { CandidateWorkspace } from './workspaceStorage';

interface WorkspaceHomeProps {
  workspace: CandidateWorkspace;
  onOpenEvidence: () => void;
  onOpenOpportunity: () => void;
  onOpenActionPackage: () => void;
  onEdit: () => void;
  onClear: () => void;
}

const MARKET_LABELS: Record<CandidateWorkspace['market'], string> = {
  ru: 'Россия',
  international: 'Международный / релокация',
};

const URGENCY_LABELS: Record<CandidateWorkspace['urgency'], string> = {
  exploring: 'Изучаю варианты',
  active: 'Активный поиск',
  urgent: 'Нужен быстрый переход',
};

export function WorkspaceHome({
  workspace,
  onOpenEvidence,
  onOpenOpportunity,
  onOpenActionPackage,
  onEdit,
  onClear,
}: WorkspaceHomeProps) {
  const [confirmingClear, setConfirmingClear] = useState(false);
  const updatedAt = new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(workspace.updatedAt));
  const roleMapReady = Boolean(workspace.analysis?.roleHypotheses.length);
  const reviewStarted = Boolean(workspace.analysis);
  const opportunityStarted = Boolean(workspace.opportunity);
  const actionPackageReady = Boolean(workspace.actionPackage);
  const nextTitle = actionPackageReady
    ? 'Продолжить пакет действия'
    : roleMapReady
      ? opportunityStarted
        ? 'Вернуться к решению по вакансии'
        : 'Разобрать одну вакансию'
      : reviewStarted
        ? 'Продолжить проверку фактов'
        : 'Подтвердить факты из резюме';

  return (
    <main className="workspace-layout" data-testid="workspace-home">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Рабочий маршрут</p>
          <h1>{workspace.targetDirection}</h1>
          <p className="workspace-subtitle">
            {actionPackageReady
              ? 'Пакет для выбранной вакансии сохранён локально и готов к продолжению.'
              : 'Контекст сохранён локально. Следующий этап строится только на подтверждённых данных.'}
          </p>
        </div>
        <div className="local-status" aria-label="Статус сохранения">
          <span aria-hidden="true" />
          Только на этом устройстве
        </div>
      </header>

      <section className="route-grid" aria-label="Состояние рабочего маршрута">
        <article className="route-primary">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Следующее сильное действие</p>
              <h2>{nextTitle}</h2>
            </div>
            <span className="step-index">
              {actionPackageReady
                ? '04 / 04'
                : opportunityStarted
                  ? '03 / 04'
                  : roleMapReady
                    ? '02 / 04'
                    : '01 / 04'}
            </span>
          </div>
          <p className="route-description">
            {actionPackageReady
              ? 'Акценты резюме, сообщение, источники фактов и чек-лист сохранены. Продолжите с того же места.'
              : roleMapReady
              ? opportunityStarted
                ? 'Источник, совпадения, gaps, неизвестное и ваше решение сохранены локально.'
                : 'Проверьте одну реальную вакансию по подтверждённым фактам. Ссылка нужна только как подпись источника.'
              : 'Система выделит задачи, результаты и масштаб. Вы решите, какие формулировки подтверждены, а какие нужно отклонить или уточнить.'}
          </p>
          <div className="route-preview" aria-label="План следующего этапа">
            <div>
              <span>Вход</span>
              <strong>
                {actionPackageReady
                  ? 'Ваше решение и подтверждённые факты'
                  : roleMapReady
                  ? 'Полный текст одной вакансии'
                  : 'Сохранённый текст резюме'}
              </strong>
            </div>
            <div>
              <span>Результат</span>
              <strong>
                {actionPackageReady
                  ? 'Резюме, сообщение и чек-лист'
                  : roleMapReady
                  ? 'Совпадения, gaps и неизвестное'
                  : 'Проверяемый список доказательств'}
              </strong>
            </div>
            <div>
              <span>Контроль</span>
              <strong>
                {actionPackageReady
                  ? 'Каждый факт связан с источником'
                  : roleMapReady
                  ? 'Итоговое действие выбираете вы'
                  : 'Каждый факт подтверждает пользователь'}
              </strong>
            </div>
          </div>
          <button
            className="button button--primary route-action"
            onClick={
              actionPackageReady
                ? onOpenActionPackage
                : roleMapReady
                  ? onOpenOpportunity
                  : onOpenEvidence
            }
          >
            {actionPackageReady
              ? 'Открыть пакет'
              : roleMapReady
              ? opportunityStarted
                ? 'Открыть решение'
                : 'Добавить вакансию'
              : reviewStarted
                ? 'Продолжить проверку'
                : 'Начать проверку'}
            <span aria-hidden="true">→</span>
          </button>
          {roleMapReady ? (
            <button
              className="text-button route-secondary-action"
              onClick={onOpenEvidence}
            >
              Открыть карту ролей
            </button>
          ) : null}
        </article>

        <aside className="context-panel" aria-label="Сохранённый контекст">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Контекст</p>
              <h2>Основа поиска</h2>
            </div>
            <button className="text-button" onClick={onEdit}>
              Изменить
            </button>
          </div>

          <dl className="context-list">
            <div>
              <dt>Направление</dt>
              <dd>{workspace.targetDirection}</dd>
            </div>
            <div>
              <dt>Рынок</dt>
              <dd>{MARKET_LABELS[workspace.market]}</dd>
            </div>
            <div>
              <dt>Режим</dt>
              <dd>{URGENCY_LABELS[workspace.urgency]}</dd>
            </div>
            <div>
              <dt>Резюме</dt>
              <dd>{workspace.resumeFileName ?? 'Текстовый источник'}</dd>
            </div>
            <div>
              <dt>Обновлено</dt>
              <dd>{updatedAt}</dd>
            </div>
          </dl>

          <div className="resume-excerpt">
            <span>Текущая ситуация</span>
            <p>{workspace.currentSituation}</p>
          </div>
        </aside>
      </section>

      <section className="workspace-footer" aria-label="Управление данными">
        <div>
          <p className="eyebrow">Данные</p>
          <p>
            Workspace хранится в localStorage этого браузера. Внешние API и
            аккаунты не используются.
          </p>
        </div>

        {confirmingClear ? (
          <div className="clear-confirmation" role="alert">
            <p>Удалить локальный workspace? Это действие нельзя отменить.</p>
            <div>
              <button
                className="button button--quiet"
                onClick={() => setConfirmingClear(false)}
              >
                Оставить
              </button>
              <button className="button button--danger" onClick={onClear}>
                Удалить данные
              </button>
            </div>
          </div>
        ) : (
          <button
            className="text-button text-button--danger"
            onClick={() => setConfirmingClear(true)}
            data-testid="workspace-clear"
          >
            Очистить локальные данные
          </button>
        )}
      </section>
    </main>
  );
}
