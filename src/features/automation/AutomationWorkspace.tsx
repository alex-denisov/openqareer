import { CaretLeft } from '@phosphor-icons/react';
import type { KeyboardEvent } from 'react';
import type { AutomationQueueItem, AutomationQueuePreview } from './automationApi';
import { AutomationConsentDialog } from './AutomationConsentDialog';
import { AutomationConsentManager } from './AutomationConsentManager';
import { AutomationHomePanel } from './AutomationHomePanel';
import { AutomationJournalPanel } from './AutomationJournalPanel';
import { AutomationPostsPanel } from './AutomationPostsPanel';
import { AutomationQueuePanel } from './AutomationQueuePanel';
import { AutomationRulesPanel } from './AutomationRulesPanel';
import { AutomationSchedulePanel } from './AutomationSchedulePanel';
import { useEscapeLayer } from '../shell/escapeLayers';
import type { useAutomationController } from './useAutomationController';
import type { useAutomationData } from './useAutomationData';

type Data = ReturnType<typeof useAutomationData>;
type Controller = ReturnType<typeof useAutomationController>;

export interface AutomationWorkspaceProps {
  readonly data: Data;
  readonly ui: Controller;
  readonly onOpenConsultant: () => void;
  readonly onOpenConnections: () => void;
  readonly onOpenTariffs: () => void;
}

export function AutomationWorkspace(props: AutomationWorkspaceProps) {
  const { ui } = props;
  return (
    <section className="automation-screen" aria-labelledby="automation-title">
      <AutomationScreenHeader onOpenConsultant={props.onOpenConsultant} />
      <AutomationTabs selected={ui.tab} onSelect={(tab) => selectAutomationTab(ui, tab)} />
      {ui.operationError ? (
        <p className="automation-error" role="alert">
          {ui.operationError}
        </p>
      ) : null}
      {ui.notice ? (
        <p className="automation-global-status" role="status">
          {ui.notice}
        </p>
      ) : null}
      <AutomationTabContent {...props} />
      <AutomationConsentLayers {...props} />
    </section>
  );
}

function AutomationScreenHeader({ onOpenConsultant }: { readonly onOpenConsultant: () => void }) {
  return (
    <header className="automation-screen-heading">
      <h1 id="automation-title">Автоматизация</h1>
      <button
        className="career-btn career-btn-secondary automation-consultant-button"
        type="button"
        onClick={onOpenConsultant}
      >
        Обсудить с консультантом
      </button>
    </header>
  );
}

function AutomationTabs({
  selected,
  onSelect,
}: {
  readonly selected: Controller['tab'];
  readonly onSelect: (tab: Controller['tab']) => void;
}) {
  return (
    <div
      className="automation-tabs"
      role="tablist"
      tabIndex={0}
      aria-label="Автоматизация"
      onKeyDown={(event) => handleAutomationTabKey(event, selected, onSelect)}
    >
      <AutomationTabButton
        id="auto"
        selected={selected === 'auto'}
        label="Автоотклики"
        onClick={() => onSelect('auto')}
      />
      <AutomationTabButton
        id="posts"
        selected={selected === 'posts'}
        label="Посты LinkedIn"
        onClick={() => onSelect('posts')}
      />
      <AutomationTabButton
        id="journal"
        selected={selected === 'journal'}
        label="Журнал"
        onClick={() => onSelect('journal')}
      />
    </div>
  );
}

function handleAutomationTabKey(
  event: KeyboardEvent<HTMLDivElement>,
  selected: Controller['tab'],
  onSelect: (tab: Controller['tab']) => void,
) {
  const order: Controller['tab'][] = ['auto', 'posts', 'journal'];
  const index = order.indexOf(selected);
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? order.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + order.length) % order.length;
  onSelect(order[next]!);
  window.requestAnimationFrame(() =>
    document.querySelector<HTMLButtonElement>(`[data-automation-tab="${order[next]}"]`)?.focus(),
  );
}

function selectAutomationTab(ui: Controller, tab: Controller['tab']) {
  ui.setTab(tab);
  ui.setSubpage('home');
  scrollAutomationToTop();
}

function AutomationTabButton({
  id,
  selected,
  label,
  onClick,
}: {
  readonly id: string;
  readonly selected: boolean;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`automation-tab-${id}`}
      aria-controls={`automation-pane-${id}`}
      aria-selected={selected}
      data-automation-tab={id}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function AutomationTabContent(props: AutomationWorkspaceProps) {
  const { ui, data } = props;
  return (
    <>
      <section
        id="automation-pane-auto"
        role="tabpanel"
        aria-labelledby="automation-tab-auto"
        tabIndex={0}
        hidden={ui.tab !== 'auto'}
      >
        <AutomationAutoTab {...props} />
      </section>
      <section
        id="automation-pane-posts"
        role="tabpanel"
        aria-labelledby="automation-tab-posts"
        tabIndex={0}
        hidden={ui.tab !== 'posts'}
      >
        <AutomationPostsPanel
          onOpenConnections={props.onOpenConnections}
          onOpenTariffs={props.onOpenTariffs}
        />
      </section>
      <section
        id="automation-pane-journal"
        role="tabpanel"
        aria-labelledby="automation-tab-journal"
        tabIndex={0}
        hidden={ui.tab !== 'journal'}
      >
        <AutomationJournalPanel
          page={data.journal}
          loading={data.journalLoading}
          error={data.journalError}
          exportBusy={ui.exportBusy}
          onFiltersChange={(filter) => void data.reloadJournal(filter)}
          onExport={() => void ui.journalActions.export()}
          onLoadMore={() => void data.reloadJournal(data.journalFilter, true)}
          onRetry={() => void data.reloadJournal(data.journalFilter)}
        />
      </section>
    </>
  );
}

function AutomationAutoTab(props: AutomationWorkspaceProps) {
  const { data, ui } = props;
  const snapshot = data.snapshot!;
  return (
    <div className="automation-auto-content" data-subpage={ui.subpage}>
      {ui.subpage !== 'home' ? (
        <AutomationSubpageBack onBack={() => returnToAutomationHome(ui)} />
      ) : null}
      <AutomationOverviewSection
        snapshot={snapshot}
        ui={ui}
        onOpenConnections={props.onOpenConnections}
      />
      <AutomationQueueSection {...props} snapshot={snapshot} />
      <AutomationScheduleSection {...props} snapshot={snapshot} />
      <AutomationRulesSection {...props} snapshot={snapshot} />
      {ui.letter ? <AutomationLetterLayer ui={ui} /> : null}
    </div>
  );
}

function AutomationSubpageBack({ onBack }: { readonly onBack: () => void }) {
  return (
    <div className="automation-back-row">
      <button type="button" className="career-btn career-btn-secondary" onClick={onBack}>
        <CaretLeft size={18} aria-hidden="true" />
        Автоматизация
      </button>
    </div>
  );
}

function AutomationOverviewSection({
  snapshot,
  ui,
  onOpenConnections,
}: {
  readonly snapshot: NonNullable<Data['snapshot']>;
  readonly ui: Controller;
  readonly onOpenConnections: () => void;
}) {
  return (
    <AutomationHomePanel
      snapshot={snapshot}
      pendingCount={snapshot.queueCounts.pending_approval}
      onOpenPage={(page) => openAutomationPage(ui, page)}
      onOpenConsent={() => ui.consent.open()}
      onOpenQueue={() => openAutomationPage(ui, 'queue')}
      onSetMode={(mode) => void ui.consent.changeMode(mode)}
      onPause={() => void ui.settingsActions.pause()}
      onResume={() => void ui.settingsActions.resume()}
      onDisable={() => void ui.settingsActions.disable()}
      onOpenConnections={onOpenConnections}
    />
  );
}

function AutomationQueueSection({
  data,
  ui,
  snapshot,
}: AutomationWorkspaceProps & { readonly snapshot: NonNullable<Data['snapshot']> }) {
  return (
    <AutomationQueuePanel
      items={data.queue}
      total={data.queueTotal}
      loading={data.queueLoading}
      error={data.queueError}
      enabled={snapshot.settings.enabled}
      canApprove={canApprove(snapshot)}
      notice=""
      refreshing={ui.queueRefreshing}
      onAction={ui.queueActions.action}
      onBulkAction={ui.queueActions.bulk}
      onRefresh={() => void ui.queueActions.refresh()}
      onEdit={(item) => void openLetter(ui, item)}
      onLoadMore={() => void data.reloadQueue(true)}
      onRetry={() => void data.reloadQueue()}
    />
  );
}

function AutomationScheduleSection(
  props: AutomationWorkspaceProps & { readonly snapshot: NonNullable<Data['snapshot']> },
) {
  return (
    <AutomationSchedulePanel
      schedule={props.snapshot.schedule}
      runtime={props.snapshot.schedulerRuntime}
      busy={props.ui.scheduleBusy}
      message=""
      onSave={props.ui.settingsActions.saveSchedule}
      onOpenConnections={props.onOpenConnections}
    />
  );
}

function AutomationRulesSection(
  props: AutomationWorkspaceProps & { readonly snapshot: NonNullable<Data['snapshot']> },
) {
  return (
    <AutomationRulesPanel
      rules={props.snapshot.settings.rules}
      stopCompanies={props.snapshot.stopCompanies}
      busy={props.ui.rulesBusy}
      message=""
      onSaveRules={props.ui.settingsActions.saveRules}
      onAddStopCompany={props.ui.settingsActions.addStopCompany}
      onRemoveStopCompany={props.ui.settingsActions.removeStopCompany}
    />
  );
}

function AutomationLetterLayer({ ui }: { readonly ui: Controller }) {
  if (!ui.letter) return null;
  return (
    <LetterDialog
      letter={ui.letter}
      value={ui.letterText}
      busy={ui.letterBusy}
      onChange={ui.setLetterText}
      onClose={() => closeLetter(ui)}
      onSave={() => void saveLetter(ui)}
    />
  );
}

function canApprove(snapshot: NonNullable<Data['snapshot']>): boolean {
  const active = snapshot.consents.some(
    (item) => item.key === 'send_after_approval' && !item.revokedAt,
  );
  return snapshot.settings.mode !== 'drafts_only' && active;
}

function openAutomationPage(ui: Controller, page: 'queue' | 'settings' | 'rules') {
  if (isMobileViewport()) {
    ui.setSubpage(page);
    scrollAutomationToTop();
  } else {
    window.requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`[data-page="${page}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  }
}

function returnToAutomationHome(ui: Controller) {
  ui.setSubpage('home');
  scrollAutomationToTop();
}

function closeLetter(ui: Controller) {
  ui.setLetter(null);
  returnToAutomationQueue(ui);
}

function returnToAutomationQueue(ui: Controller) {
  ui.setSubpage('queue');
  scrollAutomationToTop();
}

async function saveLetter(ui: Controller) {
  if (!ui.letter) return;
  const saved = await ui.queueActions.saveLetter(ui.letter, ui.letterText);
  if (saved) returnToAutomationQueue(ui);
}

async function openLetter(ui: Controller, item: AutomationQueueItem) {
  const opened = await ui.queueActions.openLetter(item);
  if (opened && isMobileViewport()) {
    ui.setSubpage('letter');
    scrollAutomationToTop();
  }
}

function LetterDialog({
  letter,
  value,
  busy,
  onChange,
  onClose,
  onSave,
}: {
  readonly letter: AutomationQueuePreview;
  readonly value: string;
  readonly busy: boolean;
  readonly onChange: (value: string) => void;
  readonly onClose: () => void;
  readonly onSave: () => void;
}) {
  useEscapeLayer(onClose, !busy);
  return (
    <div className="automation-dialog-backdrop">
      <section
        className="automation-letter-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="automation-letter-title"
      >
        <LetterDialogHeader letter={letter} busy={busy} onClose={onClose} />
        <label htmlFor="automation-letter-text">Текст письма</label>
        <textarea
          id="automation-letter-text"
          rows={8}
          maxLength={5000}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          disabled={busy}
        />
        <LetterMaterials materials={letter} />
        <LetterDialogActions busy={busy} onSave={onSave} onClose={onClose} />
      </section>
    </div>
  );
}

function LetterDialogHeader({
  letter,
  busy,
  onClose,
}: {
  readonly letter: AutomationQueuePreview;
  readonly busy: boolean;
  readonly onClose: () => void;
}) {
  return (
    <header>
      <div>
        <h2 id="automation-letter-title">Письмо · {letter.company}</h2>
        <p>
          {letter.role} · {letter.platform === 'hh' ? 'hh.ru' : 'LinkedIn'}
        </p>
      </div>
      <button
        className="automation-icon-button"
        type="button"
        aria-label="Закрыть письмо"
        disabled={busy}
        onClick={onClose}
      >
        <CaretLeft size={20} aria-hidden="true" />
      </button>
    </header>
  );
}

function LetterDialogActions({
  busy,
  onSave,
  onClose,
}: {
  readonly busy: boolean;
  readonly onSave: () => void;
  readonly onClose: () => void;
}) {
  return (
    <footer>
      <button
        className="career-btn career-btn-primary"
        type="button"
        disabled={busy}
        onClick={onSave}
      >
        {busy ? 'Сохраняем…' : 'Сохранить письмо'}
      </button>
      <button
        className="career-btn career-btn-secondary"
        type="button"
        disabled={busy}
        onClick={onClose}
      >
        Отмена
      </button>
    </footer>
  );
}

function LetterMaterials({ materials }: { readonly materials: AutomationQueuePreview }) {
  return (
    <div className="automation-material-list">
      <strong>Материалы</strong>
      {materials.materials.length ? (
        materials.materials.map((item) => (
          <span key={item.documentId}>
            {item.fileName} · версия {item.version}
          </span>
        ))
      ) : (
        <span>Материалы не указаны.</span>
      )}
    </div>
  );
}

function AutomationConsentLayers({ data, ui, onOpenTariffs }: AutomationWorkspaceProps) {
  const snapshot = data.snapshot!;
  if (ui.consentFlow === 'enable')
    return (
      <AutomationConsentDialog
        busy={ui.busy}
        error={ui.consentError}
        initialMode={ui.consentMode}
        initialAcceptedKeys={snapshot.consents
          .filter((item) => !item.revokedAt)
          .map((item) => item.key)}
        onClose={() => ui.setConsentFlow(null)}
        onSubmit={(mode, keys) => void ui.consent.submit(mode, keys)}
        onOpenTariffs={() => {
          ui.setConsentFlow(null);
          onOpenTariffs();
        }}
      />
    );
  if (ui.consentFlow === 'manage')
    return (
      <AutomationConsentManager
        consents={snapshot.consents}
        busyKey={ui.consentBusyKey}
        onClose={() => ui.setConsentFlow(null)}
        onRevoke={(key) => void ui.consent.revoke(key)}
      />
    );
  return null;
}

function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches;
}

function scrollAutomationToTop() {
  window.requestAnimationFrame(() =>
    document.getElementById('career-main')?.scrollTo({ top: 0, behavior: 'auto' }),
  );
}
