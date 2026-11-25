import { useEffect, useMemo, useState } from 'react';
import type { VacancyFitView } from '../../../../../shared/vacancyFit';
import { FIT_COUNTING_STATES } from '../../../../../shared/vacancyFitPercent';
import { readSectionCache, writeSectionCache } from '../../../shell/sectionCache';
import { useVacancyDetail } from '../../../vacancies/vacancyDetailApi';
import { readVacancyFit } from '../../../vacancies/vacancyFitApi';
import { briefView, type BriefView } from './briefLines';

/** `null` — расчёта нет: требования идут из текста, без пометок. */
function useFit(clusterId: string): VacancyFitView | null | undefined {
  const [read, setRead] = useState<{ readonly id: string; readonly view: VacancyFitView | null }>();
  useEffect(() => {
    const controller = new AbortController();
    readVacancyFit(clusterId, controller.signal).then(
      (view) => setRead({ id: clusterId, view }),
      () => {
        if (!controller.signal.aborted) setRead({ id: clusterId, view: null });
      },
    );
    return () => controller.abort();
  }, [clusterId]);
  return read?.id === clusterId ? read.view : undefined;
}

function Skeleton() {
  return (
    <div
      className="vs-br is-skel"
      role="status"
      aria-busy="true"
      aria-label="Читаем текст вакансии"
    >
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

const cacheKey = (clusterId: string): string => `vacancies:brief:${clusterId}`;

/** Краткое содержание раскрытой вакансии (B791): задачи и требования строками её текста. */
export function BriefBlock({ clusterId }: { readonly clusterId: string }) {
  const known = readSectionCache<BriefView>(cacheKey(clusterId));
  return known ? <BriefLines view={known} /> : <BriefRead key={clusterId} clusterId={clusterId} />;
}

function BriefRead({ clusterId }: { readonly clusterId: string }) {
  const detail = useVacancyDetail(clusterId, true);
  const fit = useFit(clusterId);
  const brief =
    detail.status === 'ready' && !detail.detail.pending && !detail.detail.textHidden
      ? detail.detail.brief
      : undefined;
  const view = useMemo(
    () => (brief && fit !== undefined ? briefView(brief, fit ?? undefined) : undefined),
    [brief, fit],
  );
  const settled = fit !== undefined && fit !== null && !FIT_COUNTING_STATES.includes(fit.state);
  // Расчёт ещё идёт или не прочитан — следующее раскрытие прочитает его заново.
  useEffect(() => {
    if (view && settled) writeSectionCache(cacheKey(clusterId), view);
  }, [clusterId, settled, view]);
  const reading = detail.status === 'idle' || detail.status === 'loading' || fit === undefined;
  if (reading || (detail.status === 'ready' && detail.detail.pending)) return <Skeleton />;
  return view ? <BriefLines view={view} /> : null;
}

function BriefLines({ view }: { readonly view: BriefView }) {
  const { duties, requirements, opening } = view;
  if (opening) {
    return (
      <div className="vs-br">
        <p>{opening}</p>
      </div>
    );
  }
  return (
    <div className={duties.length > 0 && requirements.length > 0 ? 'vs-br is-two' : 'vs-br'}>
      {duties.length > 0 ? (
        <div>
          <span className="vs-br-k">Задачи</span>
          <ul>
            {duties.map((text, index) => (
              <li key={index}>{text}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {requirements.length > 0 ? (
        <div>
          <span className="vs-br-k">Требования</span>
          <ul>
            {requirements.map(({ text, missing }, index) => (
              <li key={index}>
                {text}
                {missing ? (
                  <>
                    {' · '}
                    <span className="vs-br-miss">нет в профиле</span>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
