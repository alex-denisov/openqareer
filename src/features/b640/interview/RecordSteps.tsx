import { Icon, Link } from '../kit';
import { buildNodePath } from '../routes';
import { CtxHead } from '../shell/CtxHead';
import type { DebriefData } from './data/debriefApi';
import { canRecordInApp } from './data/recordingBridge';
import { formatInterviewWhen } from './model/prepModel';

/** Шаги записи (I4b, I4c): «Запись или файл · Голоса · Разбор». */
export function RecordSteps(props: {
  readonly responseId: string;
  readonly current: 'source' | 'voices';
}) {
  const { responseId, current } = props;
  const source = canRecordInApp() ? 'i04b' : 'i04c';
  return (
    <nav className="tabs sec-tabs r6-steps" aria-label="Шаги">
      <div className="sec-tabs-in">
        <Link
          to={buildNodePath(source, { responseId })}
          aria-current={current === 'source' ? 'page' : undefined}
        >
          {current === 'voices' ? <Icon name="check" /> : null}
          Запись или файл
        </Link>
        <Link
          to={buildNodePath('i04c', { responseId })}
          aria-current={current === 'voices' ? 'page' : undefined}
        >
          Голоса
        </Link>
        <Link to={buildNodePath('i04', { responseId })}>Разбор</Link>
      </div>
    </nav>
  );
}

/** Шапка контекста I4b/I4c: компания, должность, когда и с кем интервью. */
export function SourceHead({ data }: { readonly data: DebriefData }) {
  const { response, debrief } = data;
  const when = formatInterviewWhen(debrief?.scheduledAt ?? null);
  const meta = [when ? `интервью ${when}` : null, debrief?.format?.trim() || null].filter(
    (item): item is string => Boolean(item),
  );
  return (
    <CtxHead
      kind="Интервью"
      title={[response.vacancy?.company, response.vacancy?.title].filter(Boolean).join(' · ')}
      meta={meta.length > 0 ? meta : undefined}
      open={{
        path: buildNodePath('o01c', { responseId: response.id }),
        label: 'Открыть: интервью',
      }}
    />
  );
}
