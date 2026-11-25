import { useCallback, useState } from 'react';
import type { OwnVacancyDetail } from '../../../../../shared/b640OwnVacancy';
import { workFormatLabel } from '../../../../../shared/vacancyWorkFormat';
import { Dialog, Icon } from '../../kit';
import { useB640Title } from '../../kit/useB640Title';
import { BlockError, BlockSkeleton } from '../../today/parts';
import { useLoad } from '../../today/useLoad';
import { NO_COMPANY } from '../companyPath';
import { safeHttpUrl } from '../format';
import { OwnRequirements, OwnTextBody } from '../list/OwnDetailParts';
import { getOwnVacancy } from '../ownVacancyApi';
import './card.css';

/** «Руководитель группы» длиннее этого набирается мельче, как в шапке обычной карточки. */
const LONG_TITLE = 40;

function subLine({ location, workFormat }: OwnVacancyDetail): string {
  const format = workFormat ? (workFormatLabel(workFormat) ?? '').toLocaleLowerCase('ru') : '';
  return [location, format].filter(Boolean).join(' · ');
}

function Actions({ detail }: { readonly detail: OwnVacancyDetail }) {
  const [text, setText] = useState(false);
  const url = safeHttpUrl(detail.url);
  return (
    <div className="v4-act">
      {url ? (
        <div className="actions v4-act-main">
          <a className="btn is-primary" href={url} target="_blank" rel="noopener noreferrer">
            <Icon name="out" />
            Открыть на сайте
          </a>
        </div>
      ) : null}
      <button className="btn v4-text" type="button" onClick={() => setText(true)}>
        <Icon name="file" />
        Текст вакансии
      </button>
      <Dialog
        open={text}
        onClose={() => setText(false)}
        title="Текст вакансии"
        className="v4-text-dlg"
      >
        <OwnTextBody text={detail.text} />
      </Dialog>
    </div>
  );
}

function Card({ detail }: { readonly detail: OwnVacancyDetail }) {
  const sub = subLine(detail);
  useB640Title(detail.title);
  return (
    <div className="col">
      <section className="lead vd-lead v4-head" aria-labelledby="vc-title">
        <p className="v4-coname">
          <span className="v4-co-a">
            <Icon name="building" />
            {detail.company?.trim() || NO_COMPANY}
          </span>
        </p>
        {sub ? <p className="v4-co-sub">{sub}</p> : null}
        <h2
          className={detail.title.length > LONG_TITLE ? 'lead-title is-long' : 'lead-title'}
          id="vc-title"
        >
          {detail.title}
        </h2>
      </section>
      <div className="v4-head2">
        <p className="v4-one">Сравнение с одной вакансией — не оценка рынка</p>
        <OwnRequirements fit={detail.fit} folded />
        <Actions detail={detail} />
      </div>
    </div>
  );
}

/** v04c: карточка своей вакансии кандидата — отдельный экран, видна только ему. */
export function OwnCardScreen({ vacancyId }: { readonly vacancyId: string }) {
  const read = useCallback((signal: AbortSignal) => getOwnVacancy(vacancyId, signal), [vacancyId]);
  const load = useLoad(read);
  return (
    <div className="page v4" data-b640-node="v04" data-b640-section="vacancies">
      {load.state === 'loading' ? (
        <div className="col">
          <BlockSkeleton label="Загружаем вакансию" rows={4} />
        </div>
      ) : null}
      {load.state === 'error' ? (
        <div className="col">
          <BlockError text="Не удалось открыть вакансию" onRetry={load.retry} />
        </div>
      ) : null}
      {load.state === 'ready' ? <Card detail={load.data} /> : null}
    </div>
  );
}
