import { TriageBar, TriageError, TriageQuestion, TriageStatus } from './TriageParts';
import type { Triage } from './useTriage';

/** Всё, что режим «Помочь выбрать» добавляет над таблицей: вопрос, полоса, состояния. */
export function TriagePanel({ triage }: { triage: Triage }) {
  if (!triage.active) {
    return triage.nothing === null ? null : <TriageStatus kind="nothing" {...triage.nothing} />;
  }
  const { status, question, hide, triage: data } = triage;
  const loading = status === 'loading' || status === 'idle';
  return (
    <>
      {question && !loading ? <TriageQuestion question={question} onAnswer={triage.answer} /> : null}
      <TriageBar
        count={triage.picked}
        busy={hide.status === 'busy'}
        loading={loading}
        onHide={triage.hideSelected}
        onCancel={triage.cancel}
      />
      {loading ? <TriageStatus kind="loading" total={triage.total} /> : null}
      {status === 'failed' ? (
        <TriageError text="Не удалось разобрать подборку" onRetry={triage.retry} />
      ) : null}
      {hide.status === 'failed' ? (
        <TriageError text={`Не скрыто вакансий: ${hide.failed}`} onRetry={triage.hideSelected} />
      ) : null}
      {status === 'ready' && data?.poolTotal !== undefined && data.poolTotal > data.summary.total ? (
        <TriageStatus kind="capped" total={data.summary.total} pool={data.poolTotal} />
      ) : null}
      {status === 'ready' && triage.weak && data ? (
        <TriageStatus kind="weak" keep={data.summary.keep} total={data.summary.total} />
      ) : null}
    </>
  );
}
