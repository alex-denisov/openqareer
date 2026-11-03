import { useId, useState, type ReactNode } from 'react';
import { pluralRu } from '../../../shared/pluralRu';
import type { ApplicationView } from './applicationsApi';
import { computePipelineAnalytics } from './pipelineAnalytics';
import { humanSourceLabel } from './sourceLabels';

interface ChannelTotals {
  readonly key: string;
  readonly label: string;
  readonly total: number;
  readonly responded: number;
  readonly interview: number;
}

function share(part: number, total: number): string {
  const value = total > 0 ? (part / total) * 100 : 0;
  const text = value.toLocaleString('ru-RU', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${text} % (${part.toLocaleString('ru-RU')})`;
}

export function mobileChannelGroups(
  applications: readonly ApplicationView[],
): readonly ChannelTotals[] {
  const sources = computePipelineAnalytics(applications).sources;
  const groups = sources.map((source) => ({
    key: source.source,
    label: humanSourceLabel(source.source),
    total: source.total,
    responded: source.responded,
    interview: source.interview,
  }));
  if (groups.length < 2) return groups;
  const sum = (field: 'total' | 'responded' | 'interview') =>
    groups.reduce((acc, group) => acc + group[field], 0);
  return [
    ...groups,
    {
      key: 'all',
      label: 'Всего',
      total: sum('total'),
      responded: sum('responded'),
      interview: sum('interview'),
    },
  ];
}

/** Push «Каналы» (макет 5, `learn`): one grouped card per channel and «Всего». */
export function ResponsesMobileChannels({
  applications,
  explanation,
}: {
  readonly applications: readonly ApplicationView[];
  /** Stage analytics stays reachable here, behind «Аналитика этапов». */
  readonly explanation?: ReactNode;
}) {
  const groups = mobileChannelGroups(applications);
  const count = applications.length;
  return (
    <div className="career-responses-mobile-channels">
      <header className="career-responses-mobile-push-intro">
        <h3>Результативность по каналам</h3>
        <p>
          {count.toLocaleString('ru-RU')}{' '}
          {pluralRu(count, ['отклик', 'отклика', 'откликов']).replace(/^\S+\s/u, '')} по текущим
          фильтрам
        </p>
      </header>
      {groups.length === 0 ? (
        <p className="career-responses-mobile-empty">Нет откликов за выбранный период.</p>
      ) : (
        groups.map((group) => <ChannelGroup key={group.key} group={group} />)
      )}
      {groups.length > 0 ? (
        <p className="career-responses-mobile-note">
          Это наблюдение, не обещание результата: роли и компании в каналах разные.
        </p>
      ) : null}
      {explanation ? <StageAnalyticsDisclosure>{explanation}</StageAnalyticsDisclosure> : null}
    </div>
  );
}

function ChannelGroup({ group }: { readonly group: ChannelTotals }) {
  return (
    <section className="career-responses-mobile-group" aria-label={group.label}>
      <h4>{group.label}</h4>
      <dl className="career-responses-mobile-list">
        <div>
          <dt>Откликов</dt>
          <dd className="career-numeric">{group.total.toLocaleString('ru-RU')}</dd>
        </div>
        <div>
          <dt>Ответили</dt>
          <dd className="career-numeric">{share(group.responded, group.total)}</dd>
        </div>
        <div>
          <dt>Интервью</dt>
          <dd className="career-numeric">{share(group.interview, group.total)}</dd>
        </div>
      </dl>
    </section>
  );
}

function StageAnalyticsDisclosure({ children }: { readonly children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="career-responses-mobile-disclosure">
      <button
        type="button"
        className="career-btn career-btn-ghost"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        Аналитика этапов
      </button>
      <div id={id} hidden={!open}>
        {open ? children : null}
      </div>
    </div>
  );
}
