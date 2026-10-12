import { Clock, ListChecks, ShieldCheck, SlidersHorizontal } from '@phosphor-icons/react';
import type {
  CandidateAutomationMode,
  CandidateAutomationRuntime,
  CandidateAutomationSettings,
} from '../../../server/candidate/sqliteCandidateAutomationRepository';
import type { CandidateAutomationSnapshot } from './automationApi';
import { automationDateLabel } from './automationFormat';

export interface AutomationHomePanelProps {
  readonly snapshot: CandidateAutomationSnapshot;
  readonly pendingCount: number;
  readonly onOpenPage: (page: 'queue' | 'settings' | 'rules') => void;
  readonly onOpenConsent: () => void;
  readonly onOpenQueue: () => void;
  readonly onSetMode: (mode: CandidateAutomationMode) => void;
  readonly onPause: () => void;
  readonly onResume: () => void;
  readonly onDisable: () => void;
  readonly onOpenConnections: () => void;
}

export function AutomationHomePanel(props: AutomationHomePanelProps) {
  return (
    <section
      className="automation-overview"
      data-page="home"
      aria-labelledby="automation-home-title"
    >
      {props.snapshot.settings.enabled ? (
        <EnabledHomeView {...props} />
      ) : (
        <DisabledOverview
          onOpenConsent={props.onOpenConsent}
          onOpenConnections={props.onOpenConnections}
        />
      )}
    </section>
  );
}

function EnabledHomeView(props: AutomationHomePanelProps) {
  const { settings, schedulerRuntime } = props.snapshot;
  const paused = isPaused(settings, schedulerRuntime);
  return (
    <>
      <HomeHeader runtime={schedulerRuntime} />
      <HomeSummary snapshot={props.snapshot} pendingCount={props.pendingCount} />
      <p className="automation-home-note">
        Одобрение ставит отклик в расписание. Статус доставки появится после квитанции площадки.
      </p>
      <RuntimeNotices runtime={schedulerRuntime} onOpenConnections={props.onOpenConnections} />
      <ModePicker mode={settings.mode} onSetMode={props.onSetMode} />
      <HomeShortcuts
        onOpenPage={props.onOpenPage}
        onOpenQueue={props.onOpenQueue}
        onOpenConsent={props.onOpenConsent}
      />
      <HomeActions
        paused={paused}
        onPause={props.onPause}
        onResume={props.onResume}
        onDisable={props.onDisable}
        onOpenQueue={props.onOpenQueue}
      />
      <p className="automation-home-footnote">
        Публикация в LinkedIn всегда ручная.{' '}
        {paused ? 'Очередь приостановлена.' : 'Отправки идут по выбранному расписанию.'}
      </p>
    </>
  );
}

function HomeHeader({ runtime }: { readonly runtime: CandidateAutomationRuntime }) {
  return (
    <header className="automation-home-heading">
      <div>
        <p className="automation-eyebrow">Режим</p>
        <h2 id="automation-home-title">Автоотклики включены</h2>
      </div>
      <span className={`automation-status-chip is-${runtime.status}`}>
        {runtimeStatusLabel(runtime.status)}
      </span>
    </header>
  );
}

function HomeSummary({
  snapshot,
  pendingCount,
}: {
  readonly snapshot: CandidateAutomationSnapshot;
  readonly pendingCount: number;
}) {
  return (
    <div className="automation-summary-grid">
      <SummaryValue label="Ждут вашего одобрения" value={pendingCount} />
      <SummaryValue
        label="Следующая отправка"
        value={
          snapshot.schedulerRuntime.nextSendAt
            ? automationDateLabel(snapshot.schedulerRuntime.nextSendAt)
            : 'Не запланирована'
        }
      />
    </div>
  );
}

function SummaryValue({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | number;
}) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function RuntimeNotices({
  runtime,
  onOpenConnections,
}: {
  readonly runtime: CandidateAutomationRuntime;
  readonly onOpenConnections: () => void;
}) {
  return (
    <>
      {runtime.status === 'error' ? (
        <p className="automation-error" role="alert">
          Последняя отправка завершилась ошибкой. Подробности — в журнале.
        </p>
      ) : null}
      {runtime.status === 'daily_limit_reached' ? (
        <p className="automation-warning" role="status">
          Дневной лимит достигнут. Новые отправки начнутся в следующем разрешённом окне.
        </p>
      ) : null}
      {runtime.status === 'linkedin_not_connected' ? (
        <div className="automation-error-row" role="status">
          <span>LinkedIn не подключён. Отправка через эту площадку не начнётся.</span>
          <button
            className="career-btn career-btn-secondary"
            type="button"
            onClick={onOpenConnections}
          >
            Подключения
          </button>
        </div>
      ) : null}
    </>
  );
}

function ModePicker({
  mode,
  onSetMode,
}: {
  readonly mode: CandidateAutomationMode;
  readonly onSetMode: (mode: CandidateAutomationMode) => void;
}) {
  return (
    <fieldset className="automation-mode-picker">
      <legend>Режим</legend>
      <ModeOption
        id="drafts"
        label="Только черновики"
        detail="Отправляете вы сами."
        value="drafts_only"
        current={mode}
        onSelect={onSetMode}
      />
      <ModeOption
        id="approval"
        label="С одобрением"
        detail="Каждый отклик подтверждаете отдельно."
        value="approval_required"
        current={mode}
        onSelect={onSetMode}
      />
      <ModeOption
        id="automatic"
        label="Автоматически"
        detail="Без одобрения пока недоступно: исполнитель не подключён."
        value="automatic"
        current={mode}
        disabled
        onSelect={onSetMode}
      />
    </fieldset>
  );
}

function ModeOption({
  id,
  label,
  detail,
  value,
  current,
  disabled = false,
  onSelect,
}: {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly value: CandidateAutomationMode;
  readonly current: CandidateAutomationMode;
  readonly disabled?: boolean;
  readonly onSelect: (mode: CandidateAutomationMode) => void;
}) {
  return (
    <label htmlFor={`automation-home-mode-${id}`}>
      <input
        id={`automation-home-mode-${id}`}
        type="radio"
        aria-label={label}
        name="automation-home-mode"
        value={value}
        checked={current === value}
        disabled={disabled}
        onChange={() => onSelect(value)}
      />
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
    </label>
  );
}

function HomeShortcuts({
  onOpenPage,
  onOpenQueue,
  onOpenConsent,
}: {
  readonly onOpenPage: AutomationHomePanelProps['onOpenPage'];
  readonly onOpenQueue: () => void;
  readonly onOpenConsent: () => void;
}) {
  return (
    <div className="automation-shortcuts" aria-label="Настройки автооткликов">
      <button type="button" onClick={onOpenQueue}>
        <ListChecks size={20} aria-hidden="true" />
        <span>
          <strong>Очередь на одобрение</strong>
          <small>Записи и фильтры</small>
        </span>
      </button>
      <button type="button" onClick={() => onOpenPage('settings')}>
        <SlidersHorizontal size={20} aria-hidden="true" />
        <span>
          <strong>Настройка режима</strong>
          <small>площадки, лимиты и паузы</small>
        </span>
      </button>
      <button type="button" onClick={() => onOpenPage('rules')}>
        <ShieldCheck size={20} aria-hidden="true" />
        <span>
          <strong>Правила отбора</strong>
          <small>роли, совпадение, стоп-компании</small>
        </span>
      </button>
      <button type="button" onClick={onOpenConsent}>
        <ShieldCheck size={20} aria-hidden="true" />
        <span>
          <strong>Согласия</strong>
          <small>проверить и отозвать</small>
        </span>
      </button>
    </div>
  );
}

function HomeActions({
  paused,
  onPause,
  onResume,
  onDisable,
  onOpenQueue,
}: {
  readonly paused: boolean;
  readonly onPause: () => void;
  readonly onResume: () => void;
  readonly onDisable: () => void;
  readonly onOpenQueue: () => void;
}) {
  return (
    <>
      <div className="automation-home-actions">
        {paused ? (
          <button className="career-btn career-btn-secondary" type="button" onClick={onResume}>
            Снять паузу
          </button>
        ) : (
          <button className="career-btn career-btn-secondary" type="button" onClick={onPause}>
            <Clock size={18} aria-hidden="true" />
            Пауза на 7 дней
          </button>
        )}
        <button className="career-btn career-btn-secondary" type="button" onClick={onDisable}>
          Выключить автоотклики
        </button>
      </div>
      <button
        className="career-btn career-btn-primary automation-open-queue"
        type="button"
        onClick={onOpenQueue}
      >
        Открыть очередь
      </button>
    </>
  );
}

function DisabledOverview({
  onOpenConsent,
  onOpenConnections,
}: {
  readonly onOpenConsent: () => void;
  readonly onOpenConnections: () => void;
}) {
  return (
    <div className="automation-disabled-view">
      <h2 id="automation-home-title">Автоотклики выключены</h2>
      <p>Сервис готовит письма под вакансии. Отклик отправится только после вашего одобрения.</p>
      <div className="automation-info-note">
        <ShieldCheck size={20} aria-hidden="true" />
        <span>Публикация в LinkedIn остаётся ручной. Отзыв согласия остановит очередь.</span>
      </div>
      <div className="automation-unlock-list">
        <h3>Что откроется после включения</h3>
        <button type="button" onClick={onOpenConsent}>
          <ListChecks size={20} aria-hidden="true" />
          <span>
            <strong>Очередь на одобрение</strong>
            <small>Проверка и расписание отправки</small>
          </span>
        </button>
        <button type="button" onClick={onOpenConnections}>
          <SlidersHorizontal size={20} aria-hidden="true" />
          <span>
            <strong>Площадки и лимиты</strong>
            <small>Подключение, дневной объём и окна</small>
          </span>
        </button>
        <div>
          <ShieldCheck size={20} aria-hidden="true" />
          <span>
            <strong>Правила отбора</strong>
            <small>Роли, география, совпадение и стоп-компании</small>
          </span>
        </div>
      </div>
      <button
        className="career-btn career-btn-primary automation-enable-button"
        type="button"
        onClick={onOpenConsent}
      >
        Включить автоотклики
      </button>
    </div>
  );
}

function isPaused(
  settings: CandidateAutomationSettings,
  runtime: CandidateAutomationRuntime,
): boolean {
  return (
    runtime.emergencyPaused ||
    Boolean(settings.pausedUntil && new Date(settings.pausedUntil).getTime() > Date.now())
  );
}

function runtimeStatusLabel(status: CandidateAutomationRuntime['status']): string {
  if (status === 'paused') return 'Пауза';
  if (status === 'daily_limit_reached') return 'Лимит дня достигнут';
  if (status === 'error') return 'Ошибка отправки';
  if (status === 'linkedin_not_connected') return 'LinkedIn не подключён';
  if (status === 'prepared') return 'Подготовлено';
  if (status === 'waiting') return 'Ожидает окна';
  return 'По расписанию';
}
