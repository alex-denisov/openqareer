import { useEffect, useState } from 'react';
import type { VacancyFitView } from '../../../../../shared/vacancyFit';
import { useVacancyDetail } from '../../../vacancies/vacancyDetailApi';
import { readVacancyFit } from '../../../vacancies/vacancyFitApi';
import { briefView } from './briefLines';

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

/** Краткое содержание раскрытой вакансии (B791): задачи и требования строками её текста. */
export function BriefBlock({ clusterId }: { readonly clusterId: string }) {
  const detail = useVacancyDetail(clusterId, true);
  const fit = useFit(clusterId);
  const reading = detail.status === 'idle' || detail.status === 'loading' || fit === undefined;
  if (reading || (detail.status === 'ready' && detail.detail.pending)) return <Skeleton />;
  if (detail.status !== 'ready' || detail.detail.textHidden || !detail.detail.brief) return null;
  const { duties, requirements, opening } = briefView(detail.detail.brief, fit ?? undefined);
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
            {duties.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {requirements.length > 0 ? (
        <div>
          <span className="vs-br-k">Требования</span>
          <ul>
            {requirements.map(({ text, missing }) => (
              <li key={text}>
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
