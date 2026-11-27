import { getConnections } from '../../../coach/coachApi';
import type { B640HhRaiseState } from '../../../../../shared/b640HhRaise';
import { getHhResumes } from '../../apply/hh/hhSessionApi';
import { InfoTip, StatusLine } from '../../kit';
import type { SectionProps } from '../../sections';
import { useLoad } from '../../today/useLoad';
import { PlatformRetry } from '../PlatformRetry';
import { HhNotConnected } from './HhNotConnected';
import { HhRaiseStatus } from './HhRaiseStatus';
import { getHhRaise } from './hhRaiseApi';
import { buildHhView, type HhStat, type HhView } from './hhModel';

interface HhData {
  readonly view: HhView;
  readonly raise: B640HhRaiseState | null;
}

async function readRaise(signal: AbortSignal): Promise<B640HhRaiseState | null> {
  try {
    return (await getHhRaise(signal)) ?? null;
  } catch {
    return null; // Строка поднятия читает состояние сама и показывает сбой.
  }
}

async function loadHh(signal: AbortSignal): Promise<HhData> {
  const [connections, raise, snapshot] = await Promise.all([
    getConnections(),
    readRaise(signal),
    getHhResumes(signal).catch(() => null),
  ]);
  return { view: buildHhView(connections, raise?.connected ? raise : null, snapshot), raise };
}

function Stats({ stats }: { readonly stats: readonly HhStat[] }) {
  if (!stats.length) {
    return (
      <p className="vl-empty-t" role="status">
        Данных по резюме пока нет
      </p>
    );
  }
  return (
    <>
      <div className="hh-stats-h">
        <h3 className="li-sec-t" id="hh-an">
          Аналитика
        </h3>
        <InfoTip
          label="Откуда данные"
          text="Подключение hh.ru и журнал действий OpenQareer."
        />
      </div>
      <dl className="hh-stats" aria-labelledby="hh-an">
        {stats.map((stat) => (
          <div className="hh-st" key={stat.id}>
            <dt>{stat.label}</dt>
            <dd className="num">{stat.value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function Body({ load }: { readonly load: ReturnType<typeof useLoad<HhData>> }) {
  if (load.state === 'loading') return <StatusLine state="wait" text="Загружаем hh.ru…" />;
  if (load.state === 'error') return <PlatformRetry text="Не удалось загрузить hh.ru" onRetry={load.retry} />;
  if (load.data.view.kind === 'off') return <HhNotConnected />;
  return (
    <section className="lead hh-tab" aria-labelledby="hh-t">
      <h2 className="lead-title" id="hh-t">
        Резюме на hh.ru
      </h2>
      <HhRaiseStatus initial={load.data.raise} />
      <Stats stats={load.data.view.stats} />
    </section>
  );
}

/** Узел a11 и его состояние a11b: резюме hh.ru или «hh.ru не подключён». */
export function HhScreen({ node }: SectionProps) {
  const load = useLoad(loadHh);
  return (
    <div className="page two" data-b640-node={node.code} data-b640-section={node.section}>
      <div className="col">
        <Body load={load} />
      </div>
      <div className="col" />
    </div>
  );
}
