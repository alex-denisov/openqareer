import { useState, type ReactNode } from 'react';
import { vacancySourceLabel } from '../../../../../shared/vacancySourceLabel';
import { companyLookupKey } from '../../../vacancies/vacancyScreenCollections';
import { Link, StatusLine } from '../../kit';
import { buildNodePath } from '../../routes';
import { useScreenChrome } from '../../shell/ShellContext';
import { acquaintancesOf, friendOf, pathLine, writeLabel } from './acquaintances';
import { AcquaintBlock } from './AcquaintBlock';
import { ActBar } from './ActBar';
import './card.css';
import { CompanyBlock } from './CompanyBlock';
import { ComposeView } from './ComposeView';
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
import { applyWays, type ApplyWay, type ComposeAction } from './waysModel';

type LoadedItem = NonNullable<CardData['item']>;

function waysFor(item: LoadedItem, data: CardData): readonly ApplyWay[] {
  const rows = data.people?.items;
  const friend = rows ? friendOf(rows) : undefined;
  const questions = data.questionnaire?.state === 'ready' ? data.questionnaire.questions.length : 0;
  return applyWays({
    sources: item.cluster.sources,
    primaryUrl: item.cluster.primaryUrl,
    ...(friend
      ? {
          friend: {
            name: friend.name ?? '',
            sub: pathLine(friend),
            label: writeLabel(friend.name),
            message: friend.message,
          },
        }
      : {}),
    ...(questions > 0 ? { questionCount: questions } : {}),
  });
}

interface RightColumnProps {
  readonly vacancyId: string;
  readonly item: LoadedItem;
  readonly data: CardData;
  readonly ways: readonly ApplyWay[];
  readonly companyPath: string;
}

/** Правая колонка: Деньги → О компании → Знакомые → Письмо и резюме. */
function RightColumn({ vacancyId, item, data, ways, companyPath }: RightColumnProps) {
  const acquaintances = acquaintancesOf(data.people?.items);
  return (
    <div className="col">
      <MoneyBlock
        item={item}
        rates={data.rates}
        campaign={data.campaign}
        expectation={data.expectation}
      />
      <CompanyBlock
        item={item}
        recruiter={data.recruiter}
        vacancyId={vacancyId}
        companyPath={companyPath}
        industry={data.company?.company.industry}
        location={data.company?.company.location}
        vacancyCount={data.company?.company.vacancyCount}
        sources={data.company?.company.sources}
        acquaintCount={acquaintances.length}
      />
      <AcquaintBlock people={acquaintances} />
      <LetterBlock
        vacancyId={vacancyId}
        hasHh={ways.some((way) => way.id === 'hh')}
        hhTitle={data.hhResumeTitle}
        hhFit={data.hhResumeFit}
        resume={data.circles?.resume}
      />
    </div>
  );
}

function sourceName(item: LoadedItem): string {
  const source = item.cluster.sources[0];
  return source ? vacancySourceLabel(source) : 'hh.ru';
}

function SaveFailure({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <StatusLine
      state="err"
      text="Не удалось сохранить"
      action={
        <button className="btn is-sm" type="button" onClick={onRetry}>
          Повторить
        </button>
      }
    />
  );
}

interface CardBodyProps {
  readonly vacancyId: string;
  readonly item: LoadedItem;
  readonly data: CardData;
  readonly companyPath: string;
  readonly onCompose: (action: ComposeAction) => void;
}

function CardBody({ vacancyId, item, data, companyPath, onCompose }: CardBodyProps) {
  const [textOpen, setTextOpen] = useState(false);
  const fit = useVacancyFit(vacancyId);
  const save = useSave(item, data.links);
  const state = fitBlockState(fit.view, fit.failed);
  const ways = waysFor(item, data);
  return (
    <>
      <QuotaLine />
      <div className="col">
        <Head item={item} companyPath={companyPath} save={save.button} />
        <div className="v4-head2">
          <FitBlock
            state={state}
            view={fit.view}
            sourceName={sourceName(item)}
            onRetry={fit.retry}
          />
          <ReqsBox view={fit.view} />
          <ActBar
            vacancyId={vacancyId}
            noProfile={state === 'none'}
            save={save.button}
            onOpenText={() => setTextOpen(true)}
          />
          {save.failed ? <SaveFailure onRetry={save.retry} /> : null}
        </div>
        <WaysBlock ways={ways} vacancyId={vacancyId} onCompose={onCompose} />
      </div>
      <RightColumn
        vacancyId={vacancyId}
        item={item}
        data={data}
        ways={ways}
        companyPath={companyPath}
      />
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

function Page({ children }: { readonly children: ReactNode }) {
  return (
    <div className="page two v4" data-b640-node="v04" data-b640-section="vacancies">
      {children}
    </div>
  );
}

interface LoadedCardProps {
  readonly vacancyId: string;
  readonly item: LoadedItem;
  readonly data: CardData;
}

/** Карточка или её шаг «Отклик» (a02d): «Написать <имя>» открывает черновик, «Не отправлять» и «Отправил» — назад. */
function LoadedCard({ vacancyId, item, data }: LoadedCardProps) {
  const [compose, setCompose] = useState<ComposeAction | null>(null);
  const company = item.cluster.canonicalCompany;
  const companyPath = buildNodePath('v10b', { companyId: companyLookupKey(company) || company });
  const back = () => setCompose(null);
  return (
    <>
      <StepTabs vacancyId={vacancyId} composing={compose !== null} onBack={back} />
      <Page>
        {compose ? (
          <ComposeView
            item={item}
            data={data}
            action={compose}
            sourceName={sourceName(item)}
            companyPath={companyPath}
            onBack={back}
          />
        ) : (
          <CardBody
            vacancyId={vacancyId}
            item={item}
            data={data}
            companyPath={companyPath}
            onCompose={setCompose}
          />
        )}
      </Page>
    </>
  );
}

/** Карточка вакансии (узел v04): совпадение, деньги, способы отклика, компания и знакомые. */
export function CardScreen({ vacancyId }: { readonly vacancyId: string }) {
  const data = useCardData(vacancyId);
  useScreenChrome({ crumb: data.item?.cluster.canonicalTitle });
  if (data.item) {
    return <LoadedCard key={vacancyId} vacancyId={vacancyId} item={data.item} data={data} />;
  }
  return (
    <>
      <StepTabs vacancyId={vacancyId} />
      <Page>
        <Notice data={data} />
      </Page>
    </>
  );
}
