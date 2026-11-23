import { Icon, InfoTip, Link } from '../../kit';
import { buildNodePath } from '../../routes';
import { MessageDraft } from '../../messages/MessageDraft';
import { CtxHead } from '../../shell/CtxHead';
import { rowFormat, rowGeo, type MoneyCurrency } from '../format';
import { companyFacts } from './CompanyBlock';
import { coachVerdict } from './fitRows';
import { Fold } from './Fold';
import { HireBlock } from './HireBlock';
import { MoneyBlock, useTargetCurrency } from './MoneyBlock';
import { moneyLines } from './moneyLines';
import { SrcTip } from './SrcTip';
import type { CardData } from './useCardData';
import { useVacancyFit } from './useVacancyFit';
import type { ComposeAction } from './waysModel';

type LoadedItem = NonNullable<CardData['item']>;

export interface ComposeViewProps {
  readonly vacancyId: string;
  readonly item: LoadedItem;
  readonly data: CardData;
  readonly action: ComposeAction;
  readonly sourceName: string;
  /** `null` — у вакансии нет компании: ссылки на её карточку нет. */
  readonly companyPath: string | null;
  /** «Не отправлять» и «Отправил»: назад к карточке. */
  readonly onBack: () => void;
  /** Имя в «Кто нанимает»: черновик этому человеку. */
  readonly onSwitch: (action: ComposeAction) => void;
}

/** Полное имя в дательном падеже нужно макету («Роману Ефимову»): склоняем обе части. */
function dative(name: string): string {
  return name
    .trim()
    .split(/\s+/u)
    .map((part) => {
      if (!/^[А-ЯЁ][а-яё-]+$/u.test(part)) return part;
      if (/(ов|ев|ин|ын)а$/u.test(part)) return part.replace(/а$/u, 'ой');
      if (/ия$/u.test(part)) return part.replace(/ия$/u, 'ии');
      if (/[ая]$/u.test(part)) return part.replace(/[ая]$/u, 'е');
      if (/[йь]$/u.test(part)) return part.replace(/[йь]$/u, 'ю');
      return /[бвгджзклмнпрстфхцчшщ]$/u.test(part) ? `${part}у` : part;
    })
    .join(' ');
}

function evidenceOf(data: CardData, action: ComposeAction): string | undefined {
  const target = action.message.target;
  if (!('contactId' in target)) return undefined;
  const person = data.people?.items.find(
    (row) =>
      row.message &&
      'contactId' in row.message.target &&
      row.message.target.contactId === target.contactId,
  );
  return person?.evidence ?? undefined;
}

type HeadProps = Pick<ComposeViewProps, 'item' | 'data' | 'sourceName' | 'onBack' | 'vacancyId'>;

/** «11 ноября»: дата площадки в шапке контекста, как в макете. */
function longDate(item: LoadedItem): string {
  const date = new Date(item.cluster.sources[0]?.observedAt ?? item.cluster.firstObservedAt);
  if (Number.isNaN(date.getTime())) return '';
  const format = { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' } as const;
  return new Intl.DateTimeFormat('ru-RU', format).format(date);
}

/** Строки шапки контекста: «Город, формат», вилка, «площадка, дата». */
function headMeta(
  { item, data, sourceName }: HeadProps,
  currency: MoneyCurrency,
): readonly string[] {
  const geo = rowGeo(item);
  const place = [geo, geo.startsWith('Удалённо') ? '' : rowFormat(item).toLowerCase()];
  const date = longDate(item);
  return [
    place.filter(Boolean).join(', '),
    moneyLines(item, data.rates, currency)?.big ?? '',
    date ? `${sourceName}, ${date}` : sourceName,
  ].filter(Boolean);
}

function Head(props: HeadProps) {
  const currency = useTargetCurrency(props.data.campaign);
  const { cluster } = props.item;
  return (
    <CtxHead
      kind="Вакансия"
      title={`${cluster.canonicalTitle} · ${cluster.canonicalCompany}`}
      meta={headMeta(props, currency)}
    >
      <Link
        className="row-act ctx-open"
        to={buildNodePath('v04', { vacancyId: props.vacancyId })}
        onClick={(event) => {
          event.preventDefault();
          props.onBack();
        }}
      >
        <Icon name="right" />
        Открыть: вакансия
      </Link>
    </CtxHead>
  );
}

/** Свёрнут по умолчанию; без процента совпадения вывода нет — и блока нет. */
function CoachFold({ vacancyId }: { readonly vacancyId: string }) {
  const verdict = coachVerdict(useVacancyFit(vacancyId).view);
  if (verdict === null) return null;
  return (
    <Fold title="Вывод консультанта" summaryId="v4-coach">
      <p className="mod-text">{verdict}</p>
    </Fold>
  );
}

function LeftColumn({ item, data, action, onBack, vacancyId }: ComposeViewProps) {
  const company = item.cluster.canonicalCompany;
  const evidence = evidenceOf(data, action);
  return (
    <div className="col">
      <section className="lead" aria-label={`Написать ${action.recipient}`}>
        <h2 className="lead-title">
          {`Написать ${dative(action.recipient)}`}
          <InfoTip label="Где пересеклись" text={[company, evidence].filter(Boolean).join(' · ')} />
        </h2>
        <MessageDraft
          key={JSON.stringify(action.message.target)}
          target={action.message.target}
          kind={action.message.kind}
          recipientName={action.recipient}
          onSent={onBack}
          onClose={onBack}
        />
      </section>
      <CoachFold vacancyId={vacancyId} />
    </div>
  );
}

function AboutCompany(props: Pick<ComposeViewProps, 'data' | 'item'>) {
  const facts = companyFacts({
    item: props.item,
    industry: props.data.company?.company.industry,
    location: props.data.company?.company.location,
    vacancyCount: props.data.company?.company.vacancyCount,
    sources: props.data.company?.company.sources,
  });
  if (facts.lines.length === 0) return null;
  return (
    <section className="mod v4-about-co" aria-label="О компании">
      <h3 className="mod-title">
        О компании
        {facts.sourceTip ? <SrcTip label="Откуда это число" text={facts.sourceTip} /> : null}
      </h3>
      <ul className="v4-co">
        {facts.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

function RightColumn({ item, data, companyPath, vacancyId, onSwitch }: ComposeViewProps) {
  const lines = moneyLines(item, data.rates, useTargetCurrency(data.campaign));
  return (
    <div className="col">
      {lines ? (
        <Fold title={`Деньги · ${lines.big}`}>
          <MoneyBlock
            item={item}
            rates={data.rates}
            campaign={data.campaign}
            expectation={data.expectation}
          />
        </Fold>
      ) : null}
      <Fold title="О компании и люди">
        <AboutCompany item={item} data={data} />
        <HireBlock
          company={item.cluster.canonicalCompany}
          people={data.people?.items ?? []}
          recruiter={data.recruiter}
          companyPath={companyPath}
          vacancyId={vacancyId}
          onWrite={onSwitch}
        />
      </Fold>
    </div>
  );
}

/** Шаг «Отклик» карточки (a02d): письмо знакомому слева, деньги и люди компании справа. */
export function ComposeView(props: ComposeViewProps) {
  return (
    <>
      <Head {...props} />
      <LeftColumn {...props} />
      <RightColumn {...props} />
    </>
  );
}
