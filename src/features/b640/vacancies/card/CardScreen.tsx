import { useState } from 'react';
import { vacancySourceLabel } from '../../../../../shared/vacancySourceLabel';
import { companyLookupKey } from '../../../vacancies/vacancyScreenCollections';
import { Link, StatusLine } from '../../kit';
import { buildNodePath } from '../../routes';
import { useScreenChrome } from '../../shell/ShellContext';
import { acquaintancesOf } from './acquaintances';
import { AcquaintBlock } from './AcquaintBlock';
import { ActBar } from './ActBar';
import './card.css';
import { CompanyBlock } from './CompanyBlock';
import { fitBlockState } from './fitRows';
import { FitBlock } from './FitBlock';
import { Head } from './Head';
import { LetterBlock } from './LetterBlock';
import { MoneyBlock } from './MoneyBlock';
import { QuotaLine } from './QuotaLine';
import { ReqsBox } from './ReqsBox';
import { StepTabs } from './StepTabs';
import { TextDialog } from './TextDialog';
import { useCardData, type CardData } from './useCardData';
import { useSave } from './useSave';
import { useVacancyFit } from './useVacancyFit';
import { WaysBlock } from './WaysBlock';
import { applyWays } from './waysModel';

type LoadedItem = NonNullable<CardData['item']>;

function CardBody({ vacancyId, item, data }: { readonly vacancyId: string; readonly item: LoadedItem; readonly data: CardData }) {
  const [textOpen, setTextOpen] = useState(false);
  const fit = useVacancyFit(vacancyId);
  const save = useSave(item, data.links);
  const state = fitBlockState(fit.view, fit.failed);
  const company = item.cluster.canonicalCompany;
  const companyPath = buildNodePath('v10b', { companyId: companyLookupKey(company) || company });
  const source = item.cluster.sources[0];
  const ways = applyWays({
    sources: item.cluster.sources,
    primaryUrl: item.cluster.primaryUrl,
    recruiterName: data.recruiter?.fullName,
  });
  return (
    <>
      <QuotaLine />
      <div className="col">
        <Head item={item} companyPath={companyPath} save={save.button} />
        <div className="v4-head2">
          <FitBlock state={state} view={fit.view} sourceName={source ? vacancySourceLabel(source) : 'hh.ru'} onRetry={fit.retry} />
          <ReqsBox view={fit.view} />
          <ActBar vacancyId={vacancyId} noProfile={state === 'none'} save={save.button} onOpenText={() => setTextOpen(true)} />
          {save.failed ? (
            <StatusLine
              state="err"
              text="Не удалось сохранить"
              action={
                <button className="btn is-sm" type="button" onClick={save.retry}>
                  Повторить
                </button>
              }
            />
          ) : null}
        </div>
        <WaysBlock ways={ways} vacancyId={vacancyId} />
      </div>
      <div className="col">
        <MoneyBlock item={item} rates={data.rates} campaign={data.campaign} />
        <CompanyBlock item={item} recruiter={data.recruiter} vacancyId={vacancyId} companyPath={companyPath} />
        <AcquaintBlock people={acquaintancesOf(data.circles)} />
        <LetterBlock vacancyId={vacancyId} />
      </div>
      <TextDialog open={textOpen} onClose={() => setTextOpen(false)} item={item} />
    </>
  );
}

function Notice({ data }: { readonly data: CardData }) {
  if (data.load === 'loading') {
    return (
      <p className="ls-state" role="status">
        Загружаем вакансию…
      </p>
    );
  }
  if (data.load === 'failed') {
    return (
      <p className="ls-state" role="alert">
        Не удалось загрузить вакансию
        <button className="btn is-sm" type="button" onClick={data.reload}>
          Повторить
        </button>
      </p>
    );
  }
  return (
    <p className="ls-state" role="status">
      Вакансия не найдена
      <Link className="btn is-sm" to={buildNodePath('s07')}>
        К подборке
      </Link>
    </p>
  );
}

/** Карточка вакансии (узел v04): совпадение, деньги, способы отклика, компания и знакомые. */
export function CardScreen({ vacancyId }: { readonly vacancyId: string }) {
  const data = useCardData(vacancyId);
  useScreenChrome({ crumb: data.item?.cluster.canonicalTitle });
  return (
    <>
      <StepTabs vacancyId={vacancyId} />
      <div className="page two v4" data-b640-node="v04" data-b640-section="vacancies">
        {data.item ? <CardBody key={vacancyId} vacancyId={vacancyId} item={data.item} data={data} /> : <Notice data={data} />}
      </div>
    </>
  );
}
