import type { Dispatch, SetStateAction } from 'react';
import type { CandidateAutomationConsentKey, CandidateAutomationMode } from '../../../server/candidate/sqliteCandidateAutomationRepository';
import type { CandidateAutomationRules } from '../../../server/domain/candidateAutomation';
import type { CandidateAutomationSchedule } from '../../../server/candidate/candidateAutomationScheduler';
import { apiErrorMessage } from '../coach/apiClient';
import { getMatchedVacancies } from '../coach/coachApi';
import {
  actOnCandidateAutomationQueueItem,
  addCandidateStopCompany,
  disableCandidateAutomation,
  enableCandidateAutomation,
  exportCandidateAutomationJournal,
  pauseCandidateAutomation,
  previewCandidateAutomationQueueItem,
  refreshCandidateAutomationQueue,
  removeCandidateStopCompany,
  resumeCandidateAutomation,
  revokeCandidateAutomationConsent,
  saveCandidateAutomationSchedule,
  updateCandidateAutomationLetter,
  updateCandidateAutomationRules,
  type AutomationQueueAction,
  type AutomationQueueItem,
  type AutomationQueuePreview,
  type CandidateAutomationSnapshot,
} from './automationApi';
import type { useAutomationData } from './useAutomationData';

type Data = ReturnType<typeof useAutomationData>;
type Setter<T> = Dispatch<SetStateAction<T>>;

export interface AutomationHandlerContext {
  readonly data: Data;
  readonly setNotice: Setter<string>;
  readonly setOperationError: Setter<string>;
  readonly setBusy: Setter<boolean>;
  readonly setQueueRefreshing: Setter<boolean>;
  readonly setScheduleBusy: Setter<boolean>;
  readonly setRulesBusy: Setter<boolean>;
  readonly setExportBusy: Setter<boolean>;
  readonly setConsentFlow: Setter<'enable' | 'manage' | null>;
  readonly setConsentMode: Setter<CandidateAutomationMode>;
  readonly setConsentError: Setter<string>;
  readonly setConsentBusyKey: Setter<CandidateAutomationConsentKey | ''>;
  readonly setLetter: Setter<AutomationQueuePreview | null>;
  readonly setLetterText: Setter<string>;
  readonly setLetterBusy: Setter<boolean>;
}

export function createConsentHandlers(context: AutomationHandlerContext) {
  return {
    open: () => openConsent(context),
    submit: (mode: CandidateAutomationMode, keys: readonly string[]) => submitConsents(context, mode, keys),
    changeMode: (mode: CandidateAutomationMode) => changeAutomationMode(context, mode),
    revoke: (key: CandidateAutomationConsentKey) => revokeConsent(context, key),
  };
}

export function createQueueHandlers(context: AutomationHandlerContext) {
  return {
    action: (item: AutomationQueueItem, action: AutomationQueueAction) => actOnQueueItem(context, item, action),
    bulk: (items: readonly AutomationQueueItem[], action: AutomationQueueAction) => actOnQueueSelection(context, items, action),
    refresh: () => refreshQueue(context),
    openLetter: (item: AutomationQueueItem) => openQueueLetter(context, item),
    saveLetter: (letter: AutomationQueuePreview, text: string) => saveQueueLetter(context, letter, text),
  };
}

export function createSettingsHandlers(context: AutomationHandlerContext) {
  return {
    pause: () => runSnapshotAction(context, () => pauseCandidateAutomation(7), 'Пауза включена на 7 дней.'),
    resume: () => runSnapshotAction(context, resumeCandidateAutomation, 'Пауза снята.'),
    disable: () => runSnapshotAction(context, disableCandidateAutomation, 'Автоотклики выключены.'),
    saveSchedule: (schedule: CandidateAutomationSchedule) => saveSchedule(context, schedule),
    saveRules: (rules: CandidateAutomationRules) => saveRules(context, rules),
    addStopCompany: (company: string) => changeStopCompany(context, company, 'add'),
    removeStopCompany: (company: string) => changeStopCompany(context, company, 'remove'),
  };
}

export function createJournalHandlers(context: AutomationHandlerContext) {
  return { export: () => exportJournal(context) };
}

function openConsent(context: AutomationHandlerContext) {
  clearMessages(context);
  context.setConsentError('');
  if (context.data.snapshot?.settings.enabled) context.setConsentFlow('manage');
  else {
    context.setConsentMode('approval_required');
    context.setConsentFlow('enable');
  }
}

async function submitConsents(context: AutomationHandlerContext, mode: CandidateAutomationMode, keys: readonly string[]) {
  context.setBusy(true);
  context.setConsentError('');
  try {
    const rules = context.data.snapshot?.settings.rules;
    await enableCandidateAutomation({ mode, consentKeys: keys, ...(rules ? { rules } : {}) });
    context.setConsentFlow(null);
    await Promise.all([context.data.reloadSnapshot(), context.data.reloadQueue()]);
    context.setNotice('Автоотклики включены. Одобрение не считается доставкой.');
  } catch (reason: unknown) {
    context.setConsentError(apiErrorMessage(reason, 'Не удалось сохранить согласия.'));
  } finally { context.setBusy(false); }
}

async function changeAutomationMode(context: AutomationHandlerContext, mode: CandidateAutomationMode) {
  const snapshot = context.data.snapshot;
  if (!snapshot || snapshot.settings.mode === mode) return;
  const keys = activeConsentKeys(snapshot);
  if (mode === 'automatic' || !hasRequiredConsents(keys)) {
    context.setConsentMode(mode);
    context.setConsentError('');
    context.setConsentFlow('enable');
    return;
  }
  context.setBusy(true);
  context.setOperationError('');
  try {
    await enableCandidateAutomation({ mode, consentKeys: keys, rules: snapshot.settings.rules });
    await context.data.reloadSnapshot();
    context.setNotice(`Режим изменён: ${mode === 'drafts_only' ? 'только черновики' : 'с одобрением'}.`);
  } catch (reason: unknown) {
    context.setOperationError(apiErrorMessage(reason, 'Не удалось изменить режим.'));
  } finally { context.setBusy(false); }
}

async function revokeConsent(context: AutomationHandlerContext, key: CandidateAutomationConsentKey) {
  context.setConsentBusyKey(key);
  context.setConsentError('');
  try {
    await revokeCandidateAutomationConsent(key);
    await Promise.all([context.data.reloadSnapshot(), context.data.reloadQueue()]);
    context.setNotice('Согласие отозвано. Новые отправки остановлены до восстановления необходимых согласий.');
  } catch (reason: unknown) {
    context.setConsentError(apiErrorMessage(reason, 'Не удалось отозвать согласие.'));
  } finally { context.setConsentBusyKey(''); }
}

async function runSnapshotAction(context: AutomationHandlerContext, action: () => Promise<void>, success: string) {
  clearMessages(context);
  context.setBusy(true);
  try {
    await action();
    await context.data.reloadSnapshot();
    context.setNotice(success);
  } catch (reason: unknown) {
    context.setOperationError(apiErrorMessage(reason, 'Не удалось выполнить действие.'));
  } finally { context.setBusy(false); }
}

async function actOnQueueItem(context: AutomationHandlerContext, item: AutomationQueueItem, action: AutomationQueueAction) {
  clearMessages(context);
  try {
    const result = await actOnCandidateAutomationQueueItem(item.id, action);
    await Promise.all([context.data.reloadQueue(), context.data.reloadSnapshot()]);
    context.setNotice(queueActionMessage(item, action, result.execution));
  } catch (reason: unknown) {
    context.setOperationError(apiErrorMessage(reason, 'Не удалось изменить запись очереди.'));
  }
}

async function actOnQueueSelection(context: AutomationHandlerContext, items: readonly AutomationQueueItem[], action: AutomationQueueAction) {
  clearMessages(context);
  let updated = 0;
  try {
    for (const item of items) { await actOnCandidateAutomationQueueItem(item.id, action); updated += 1; }
    await Promise.all([context.data.reloadQueue(), context.data.reloadSnapshot()]);
    context.setNotice(`Обновлено записей: ${updated}.`);
  } catch (reason: unknown) {
    context.setOperationError(`${apiErrorMessage(reason, 'Не удалось выполнить часть действий.')} Обновлено записей: ${updated}.`);
    await Promise.all([context.data.reloadQueue(), context.data.reloadSnapshot()]);
  }
}

async function refreshQueue(context: AutomationHandlerContext) {
  if (!context.data.snapshot?.settings.enabled) return;
  context.setQueueRefreshing(true);
  clearMessages(context);
  try {
    const matched = await getMatchedVacancies();
    const ids = matched.map((item) => item.cluster.id).filter(Boolean);
    if (!ids.length) { context.setNotice('В подборке пока нет вакансий для очереди.'); return; }
    const result = await refreshCandidateAutomationQueue(ids);
    await Promise.all([context.data.reloadQueue(), context.data.reloadSnapshot()]);
    context.setNotice(`Добавлено в очередь: ${result.added}; пропущено по правилам: ${result.skipped}.`);
  } catch (reason: unknown) {
    context.setOperationError(apiErrorMessage(reason, 'Не удалось обновить очередь.'));
  } finally { context.setQueueRefreshing(false); }
}

async function openQueueLetter(context: AutomationHandlerContext, item: AutomationQueueItem): Promise<boolean> {
  clearMessages(context);
  try {
    const letter = await previewCandidateAutomationQueueItem(item.id);
    context.setLetter(letter);
    context.setLetterText(letter.letterText);
    return true;
  } catch (reason: unknown) {
    context.setOperationError(apiErrorMessage(reason, 'Не удалось открыть письмо.'));
    return false;
  }
}

async function saveQueueLetter(context: AutomationHandlerContext, letter: AutomationQueuePreview, text: string): Promise<boolean> {
  context.setLetterBusy(true);
  clearMessages(context);
  try {
    await updateCandidateAutomationLetter(letter.id, text);
    context.setLetter(null);
    await context.data.reloadQueue();
    context.setNotice('Письмо сохранено в очереди.');
    return true;
  } catch (reason: unknown) {
    context.setOperationError(apiErrorMessage(reason, 'Не удалось сохранить письмо.'));
    return false;
  } finally { context.setLetterBusy(false); }
}

async function saveSchedule(context: AutomationHandlerContext, schedule: CandidateAutomationSchedule) {
  context.setScheduleBusy(true);
  clearMessages(context);
  try {
    await saveCandidateAutomationSchedule(schedule);
    await context.data.reloadSnapshot();
    context.setNotice('Настройки расписания сохранены.');
  } catch (reason: unknown) {
    context.setOperationError(apiErrorMessage(reason, 'Не удалось сохранить расписание.'));
  } finally { context.setScheduleBusy(false); }
}

async function saveRules(context: AutomationHandlerContext, rules: CandidateAutomationRules) {
  context.setRulesBusy(true);
  clearMessages(context);
  try {
    await updateCandidateAutomationRules(rules);
    await context.data.reloadSnapshot();
    context.setNotice('Правила отбора сохранены.');
  } catch (reason: unknown) {
    context.setOperationError(apiErrorMessage(reason, 'Не удалось сохранить правила.'));
  } finally { context.setRulesBusy(false); }
}

async function changeStopCompany(context: AutomationHandlerContext, company: string, action: 'add' | 'remove') {
  context.setRulesBusy(true);
  clearMessages(context);
  try {
    if (action === 'add') await addCandidateStopCompany(company);
    else await removeCandidateStopCompany(company);
    await context.data.reloadSnapshot();
    context.setNotice(action === 'add' ? `${company} добавлена в стоп-компании.` : `${company} удалена из стоп-компаний.`);
  } catch (reason: unknown) {
    context.setOperationError(apiErrorMessage(reason, 'Не удалось изменить список стоп-компаний.'));
  } finally { context.setRulesBusy(false); }
}

async function exportJournal(context: AutomationHandlerContext) {
  context.setExportBusy(true);
  clearMessages(context);
  try {
    downloadJournalCsv(await exportCandidateAutomationJournal());
    context.setNotice('Экспорт журнала подготовлен.');
  } catch (reason: unknown) {
    context.setOperationError(apiErrorMessage(reason, 'Не удалось экспортировать журнал.'));
  } finally { context.setExportBusy(false); }
}

function downloadJournalCsv(csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `auto-apply-journal-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function queueActionMessage(item: AutomationQueueItem, action: AutomationQueueAction, execution: string): string {
  if (action === 'approve_and_send' && execution === 'scheduled') return 'Одобрено · ожидает отправки по расписанию.';
  if (action === 'remove') return 'Запись снята с очереди.';
  if (action === 'stop_company') return `${item.company} добавлена в стоп-компании.`;
  return 'Действие сохранено.';
}

function activeConsentKeys(snapshot: CandidateAutomationSnapshot): CandidateAutomationConsentKey[] {
  return snapshot.consents.filter((item) => !item.revokedAt).map((item) => item.key);
}

function hasRequiredConsents(keys: readonly string[]): boolean {
  return ['drafts', 'send_after_approval', 'notifications'].every((key) => keys.includes(key));
}

function clearMessages(context: AutomationHandlerContext) {
  context.setOperationError('');
  context.setNotice('');
}
