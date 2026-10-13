import type { ReactNode } from 'react';
import { apiErrorMessage } from '../coach/apiClient';
import { AutomationWorkspace } from './AutomationWorkspace';
import { useAutomationController } from './useAutomationController';
import { useAutomationData } from './useAutomationData';
import './automation.css';

export interface CandidateAutomationScreenProps {
  readonly candidateId: string;
  readonly onOpenConsultant: () => void;
  readonly onOpenConnections: () => void;
  readonly onOpenTariffs: () => void;
  readonly manualSend?: ReactNode;
}

export function CandidateAutomationScreen(props: CandidateAutomationScreenProps) {
  const data = useAutomationData(props.candidateId);
  const ui = useAutomationController(data);
  if (data.snapshotLoading) return <AutomationLoading />;
  if (!data.snapshot) return <AutomationLoadFailure message={data.snapshotError} onRetry={() => void data.reloadSnapshot().catch((reason: unknown) => data.setSnapshotError(apiErrorMessage(reason, 'Не удалось загрузить настройки автооткликов.')))} />;
  return <AutomationWorkspace data={data} ui={ui} onOpenConsultant={props.onOpenConsultant} onOpenConnections={props.onOpenConnections} onOpenTariffs={props.onOpenTariffs} manualSend={props.manualSend} />;
}

function AutomationLoading() {
  return <section className="automation-screen" aria-labelledby="automation-title" aria-busy="true">
    <header className="automation-screen-heading"><div><p className="automation-eyebrow">Отклики</p><h1 id="automation-title">Автоматизация</h1></div></header>
    <div className="automation-tabs" role="tablist" tabIndex={0} aria-label="Автоматизация"><button role="tab" aria-selected="true" type="button">Автоотклики</button><button role="tab" aria-selected="false" type="button">Посты LinkedIn</button><button role="tab" aria-selected="false" type="button">Журнал</button></div>
    <p className="automation-loading" role="status" aria-busy="true">Загружаем настройки и очередь…</p>
  </section>;
}

function AutomationLoadFailure({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }) {
  return <section className="automation-screen" aria-labelledby="automation-title">
    <h1 id="automation-title">Автоматизация</h1>
    <div className="automation-error-row" role="alert"><span>{message || 'Не удалось загрузить настройки автооткликов.'}</span><button className="career-btn career-btn-secondary" type="button" onClick={onRetry}>Повторить</button></div>
  </section>;
}
