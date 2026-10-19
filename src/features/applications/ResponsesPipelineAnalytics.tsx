import { useEffect, useId, useState } from 'react';
import { listApplicationsPool, type ApplicationListQuery, type ApplicationView } from './applicationsApi';
import { PipelineAnalyticsView, type PipelineAnalyticsViewProps } from './PipelineAnalyticsView';

type LoadState = { readonly status: 'loading' | 'error' | 'ready'; readonly applications: readonly ApplicationView[] };
export interface ResponsesPipelineAnalyticsProps extends Omit<PipelineAnalyticsViewProps, 'applications'> {
  readonly query: ApplicationListQuery;
  readonly revision: readonly ApplicationView[];
  readonly initiallyExpanded?: boolean;
}

/** Complete historical cohort, independent of active-stage and visible-page filtering. */
export function ResponsesPipelineAnalytics(props: ResponsesPipelineAnalyticsProps) {
  const id = useId();
  const [expanded, setExpanded] = useState(props.initiallyExpanded ?? false);
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState<LoadState>({ status: 'loading', applications: [] });
  const { from, to } = props.query;
  const channel = JSON.stringify(props.query.channel ?? []);
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    setLoaded({ status: 'loading', applications: [] });
    void listApplicationsPool({ from, to, channel: JSON.parse(channel) as string[] }, controller.signal).then((page) => {
      if (controller.signal.aborted) return;
      if (page.items.length < page.meta.total) throw new Error('incomplete application cohort');
      setLoaded({ status: 'ready', applications: page.items });
    }).catch(() => {
      if (!controller.signal.aborted) setLoaded({ status: 'error', applications: [] });
    });
    return () => controller.abort();
  }, [expanded, from, to, channel, retry, props.revision]);
  return (
    <section className="career-pipeline-card" aria-label="История этапов откликов">
      <button type="button" className="career-btn career-btn-secondary career-btn-sm" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded((value) => !value)}>
        Аналитика этапов
      </button>
      <div id={id} hidden={!expanded}>
        {expanded ? <AnalyticsContent loaded={loaded} props={props} retry={() => setRetry((value) => value + 1)} /> : null}
      </div>
    </section>
  );
}
function AnalyticsContent({ loaded, props, retry }: { readonly loaded: LoadState; readonly props: ResponsesPipelineAnalyticsProps; readonly retry: () => void }) {
  if (loaded.status === 'loading') return <p role="status" aria-busy="true">Загружаем полную историю этапов, включая архив.</p>;
  if (loaded.status === 'error') return <div role="alert"><p>Не удалось загрузить полную историю. Конверсии не рассчитаны.</p><button type="button" className="career-btn career-btn-secondary career-btn-sm" onClick={retry}>Повторить загрузку аналитики</button></div>;
  return <PipelineAnalyticsView applications={loaded.applications} onOpenVacancies={props.onOpenVacancies} onOpenExpert={props.onOpenExpert} />;
}
