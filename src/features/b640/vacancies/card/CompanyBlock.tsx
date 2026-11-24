import type { RecruiterContact } from '../../../../../shared/recruiterContact';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import { pluralWordRu } from '../../../../../shared/pluralRu';
import { Icon, Link } from '../../kit';
import { buildNodePath } from '../../routes';
import { Fold } from './Fold';
import { SrcTip } from './SrcTip';

export interface CompanyBlockProps {
  readonly item: MatchedVacancyItem;
  readonly recruiter: RecruiterContact | undefined;
  readonly vacancyId: string;
  /** `null` — у вакансии нет компании: ссылки на её карточку нет. */
  readonly companyPath: string | null;
  /** Отрасль и город из карточки компании (B677); пусто — берутся признаки вакансии. */
  readonly industry?: string | null | undefined;
  readonly location?: string | null | undefined;
  /** Вакансий компании в подборке, всего; эта среди них. */
  readonly vacancyCount?: number | undefined;
  /** Знакомых в компании (круги 1 и 2). */
  /** Откуда сведения о компании (hh.ru, дата). */
  readonly sources?: readonly { readonly name: string; readonly observedAt: string }[] | undefined;
  readonly acquaintCount: number;
}

export interface CompanyFacts {
  /** Первая строка: отрасль; вторая: город (и сайт, когда он известен). */
  readonly lines: readonly string[];
  readonly moreVacancies: number;
  /** «Источник: hh.ru, 10.11» — откуда сведения о компании. */
  readonly sourceTip: string | undefined;
}

function shortDate(iso: string): string {
  const [, month, day] = iso.slice(0, 10).split('-');
  return day && month ? `${day}.${month}` : '';
}

/**
 * Строки «О компании» из того, что есть: отрасль; город. Размера и сайта компании в данных нет
 * (B677 их не отдаёт) — этих частей строки нет, место блока то же.
 */
export function companyFacts(
  props: Pick<CompanyBlockProps, 'item' | 'industry' | 'location' | 'vacancyCount' | 'sources'>,
): CompanyFacts {
  const features = props.item.cluster.companyFeatures;
  const industry = props.industry || features?.industry;
  const city = props.location || features?.city;
  const names = (props.sources ?? []).map((source) =>
    [source.name, shortDate(source.observedAt)].filter(Boolean).join(' '),
  );
  return {
    lines: [industry, city].filter((value): value is string => Boolean(value)),
    moreVacancies: Math.max((props.vacancyCount ?? 1) - 1, 0),
    sourceTip: names.length > 0 ? `Источник: ${names.join(', ')}` : undefined,
  };
}

const VACANCY_FORMS: [string, string, string] = ['вакансия', 'вакансии', 'вакансий'];
const ACQUAINT_FORMS: [string, string, string] = ['знакомый', 'знакомых', 'знакомых'];

/** «Ещё 2 вакансии · 3 знакомых»: числа в `.num`, слова рядом через неразрывный пробел. */
function MoreLink({
  path,
  vacancies,
  acquaint,
}: {
  readonly path: string;
  readonly vacancies: number;
  readonly acquaint: number;
}) {
  return (
    <Link className="row-act v4-co-more" to={path}>
      <Icon name="building" />
      {vacancies === 0 && acquaint === 0 ? 'Карточка компании' : null}
      {vacancies > 0 ? (
        <>
          Ещё <span className="num">{vacancies}</span>
          {`\u00a0${pluralWordRu(vacancies, VACANCY_FORMS)}`}
        </>
      ) : null}
      {vacancies > 0 && acquaint > 0 ? ' · ' : null}
      {acquaint > 0 ? (
        <>
          <span className="num">{acquaint}</span>
          {`\u00a0${pluralWordRu(acquaint, ACQUAINT_FORMS)}`}
        </>
      ) : null}
    </Link>
  );
}

/** «О компании»: отрасль, город, рекрутёр вакансии, «Откликнуться напрямую», ссылка на компанию. */
export function CompanyBlock(props: CompanyBlockProps) {
  const { recruiter, vacancyId, companyPath } = props;
  // B726: без компании и рекрутёра блоку нечего сказать — пустой «О компании» не показываем.
  if (!companyPath && !recruiter) return null;
  const facts = companyFacts(props);
  return (
    <Fold title="О компании" className="v4-about-co" openOnDesktop>
      {facts.lines.length > 0 ? (
        <ul className="v4-co">
          {facts.lines.map((line, index) => (
            <li key={line}>
              {line}
              {index === facts.lines.length - 1 && facts.sourceTip ? (
                <SrcTip label="Откуда это число" text={facts.sourceTip} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {recruiter ? (
        <div className="v4-person">
          <p className="v4-person-t">
            <b>{recruiter.fullName}</b>
            {recruiter.roleTitle ? ` · ${recruiter.roleTitle}` : ''}
          </p>
          <Link className="row-act" to={buildNodePath('o02', { responseId: vacancyId })}>
            <Icon name="send" />
            Откликнуться напрямую
          </Link>
        </div>
      ) : null}
      {companyPath ? (
        <MoreLink
          path={companyPath}
          vacancies={facts.moreVacancies}
          acquaint={props.acquaintCount}
        />
      ) : null}
    </Fold>
  );
}
