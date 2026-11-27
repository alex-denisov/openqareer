import { pressApply } from '../../apply/applyIntent';
import { useEffect, type ReactNode } from 'react';
import type { ApplicationStage } from '../../../../../shared/applicationStage';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import { Button, Icon, InfoTip, Link, StatusLine } from '../../kit';
import { buildNodePath } from '../../routes';
import { rowMoneyView, rowDate, rowFormat, type MoneyView } from '../../vacancies/format';
import type { CurrencyRates } from '../../../../../shared/currencyRates';
import { useCurrencyRates } from '../../../vacancies/useCurrencyRates';
import { rememberClusters } from '../../shell/vacancyNames';
import { FitCell } from '../../vacancies/list/VacancyRow';
import { applicationTag, formatCount } from '../format';

export interface CompanyVacanciesProps {
  readonly vacancies: readonly MatchedVacancyItem[];
  readonly total: number;
  readonly others: readonly MatchedVacancyItem[];
  readonly othersTotal: number;
  readonly applications: Readonly<Record<string, ApplicationStage>>;
  readonly moreBusy: boolean;
  readonly moreFailed: boolean;
  readonly onMore: () => void;
}

const PAGE = 20;
const ENV = { currency: 'RUB', noRole: false } as const;
const FIT_TIP = 'Совпадение требований вакансии с подтверждённым опытом профиля.';

/** Деньги, формат и дата строки вакансии; пустая часть выпадает. */
function vacancyParts(item: MatchedVacancyItem, rates: CurrencyRates | undefined) {
  return {
    money: rowMoneyView(item, { currency: 'RUB', rates }),
    format: rowFormat(item).toLocaleLowerCase('ru-RU'),
    date: rowDate(item),
  };
}

/** Деньги строки в рублях, как в подборке; у оценки источник в title и скрытом тексте (B803). */
function Money({ money }: { readonly money: MoneyView }) {
  return (
    <span className="num" title={money.title}>
      {money.text}
      {money.estimate ? <span className="vh">, {money.title}</span> : null}
    </span>
  );
}

type RowProps = { readonly item: MatchedVacancyItem; readonly rates: CurrencyRates | undefined };

/** «480–580 тыс. ₽ · гибрид · 11.11»: деньги и дата — числа, формат — обычный текст. */
function RoleSub({ item, rates }: RowProps) {
  const { money, format, date } = vacancyParts(item, rates);
  const parts: ReactNode[] = [
    money.text ? <Money money={money} key="money" /> : null,
    format || null,
    date ? <span className="num" key="date">{date}</span> : null,
  ].filter(Boolean);
  return <div className="row-sub">{parts.flatMap((part, index) => (index ? [' · ', part] : [part]))}</div>;
}

/** «320–380 тыс. ₽ · 09.11» — другие вакансии: деньги и дата. */
function OthersSub({ item, rates }: RowProps) {
  const { money, date } = vacancyParts(item, rates);
  const parts: ReactNode[] = [money.text ? <Money money={money} key="money" /> : null, date || null].filter(Boolean);
  return <div className="row-sub num">{parts.flatMap((part, index) => (index ? [' · ', part] : [part]))}</div>;
}

function RoleRow({ item, stage, rates }: RowProps & { readonly stage: ApplicationStage | undefined }) {
  const tag = applicationTag(stage);
  return (
    <li className="row co-vrow">
      <div className="co-vmain">
        <div className="row-title">{item.cluster.canonicalTitle}</div>
        <RoleSub item={item} rates={rates} />
      </div>
      <span className="co-vfit">
        <FitCell item={item} env={ENV} />
        <InfoTip label="Как посчитано" text={FIT_TIP} />
      </span>
      {tag ? (
        <span className="tag ok">{tag}</span>
      ) : (
        <Link className="btn" to={buildNodePath('o02', { responseId: item.cluster.id })} onClick={() => pressApply(item.cluster.id)}>
          <Icon name="responses" />
          Откликнуться
        </Link>
      )}
    </li>
  );
}

function Others({ others, total, rates }: { readonly others: readonly MatchedVacancyItem[]; readonly total: number; readonly rates: CurrencyRates | undefined }) {
  if (total === 0) return null;
  return (
    <details className="more-n">
      <summary>
        <Icon name="down" />
        {`Другие вакансии компании · ${formatCount(total)}`}
      </summary>
      <ul className="rows">
        {others.map((item) => (
          <li className="row" key={item.cluster.id}>
            <div>
              <div className="row-title">{item.cluster.canonicalTitle}</div>
              <OthersSub item={item} rates={rates} />
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** «Вакансии по вашим ролям»: совпадение, деньги, формат, статус отклика; ниже — остальные вакансии. */
export function CompanyVacancies(props: CompanyVacanciesProps) {
  const { vacancies, total, applications, moreBusy, moreFailed, onMore } = props;
  // Отклик, открытый из строки, называет вакансию с первого кадра.
  useEffect(() => rememberClusters(vacancies), [vacancies]);
  const rates = useCurrencyRates();
  const left = total - vacancies.length;
  return (
    <section className="mod" aria-labelledby="co-vac">
      {/* tabIndex: сюда переводит фокус «Откликнуться на вакансию» из пустых «Людей компании». */}
      <h3 className="mod-title" id="co-vac" tabIndex={-1}>
        Вакансии по вашим ролям · <span className="num">{formatCount(total)}</span>
      </h3>
      {vacancies.length === 0 ? (
        <p className="row-sub" role="status">Подходящих вакансий сейчас нет</p>
      ) : (
        <ul className="rows co-vlist">
          {vacancies.map((item) => (
            <RoleRow key={item.cluster.id} item={item} stage={applications[item.cluster.id]} rates={rates} />
          ))}
        </ul>
      )}
      {left > 0 ? (
        <div className="vl-foot">
          <Button icon="down" busy={moreBusy} onClick={onMore}>
            <span>{`Показать ещё ${Math.min(PAGE, left)}`}</span>
          </Button>
        </div>
      ) : null}
      {moreFailed ? <StatusLine state="err" text="Не удалось загрузить. Нажмите ещё раз." /> : null}
      <Others others={props.others} total={props.othersTotal} rates={rates} />
    </section>
  );
}
