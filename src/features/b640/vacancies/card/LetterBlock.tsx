import type { HhResumeFitStatus } from '../../../../../shared/hhCandidateSession';
import { Icon, Link } from '../../kit';
import { buildNodePath } from '../../routes';
import { Fold } from './Fold';

export interface LetterBlockProps {
  readonly vacancyId: string;
  /** Вакансия с hh.ru: тогда есть строка «hh.ru» с выбранным резюме. */
  readonly hasHh: boolean;
  /** Название выбранного резюме hh.ru; `null` — не выбрано или не читали. */
  readonly hhTitle: string | null | undefined;
  /** Сверка выбранного резюме с вакансией; без неё приписки нет. */
  readonly hhFit?: HhResumeFitStatus | undefined;
  /** Резюме платформы под вакансию или общее; `undefined` — не знаем. */
  readonly resume:
    { readonly available: boolean; readonly kind: 'targeted' | 'master' } | undefined;
  /** B726: без компании нет и её сайта — строки «Сайт компании» нет. */
  readonly hasCompany?: boolean;
}

const FIT_NOTES: Readonly<Record<HhResumeFitStatus, string>> = {
  fits: ' · подходит',
  gaps: ' · есть пропуски',
  unread: '',
};

interface ResumeRow {
  readonly key: string;
  readonly title: string;
  readonly sub: string;
  readonly action: string;
}

export function resumeRows(props: Omit<LetterBlockProps, 'vacancyId'>): readonly ResumeRow[] {
  const hh: ResumeRow | undefined = props.hasHh
    ? {
        key: 'hh',
        title: 'hh.ru',
        sub: props.hhTitle
          ? `Резюме hh.ru «${props.hhTitle}»${FIT_NOTES[props.hhFit ?? 'unread']}`
          : 'Резюме hh.ru не выбрано',
        action: 'Выбрать',
      }
    : undefined;
  const own: ResumeRow | undefined =
    props.resume?.available && props.hasCompany !== false
      ? {
          key: 'site',
          title: 'Сайт компании',
          sub: props.resume.kind === 'targeted' ? 'Резюме под вакансию, PDF' : 'Общее резюме, PDF',
          action: 'Открыть',
        }
      : undefined;
  return [hh, own].filter((row): row is ResumeRow => row !== undefined);
}

/** «Письмо и резюме»: какое резюме уйдёт каналом и кнопка в письмо отклика. */
export function LetterBlock({ vacancyId, ...rest }: LetterBlockProps) {
  const rows = resumeRows(rest);
  const to = buildNodePath('o02', { responseId: vacancyId });
  return (
    <Fold title="Письмо и резюме">
      {rows.length > 0 ? (
        <ul className="rows">
          {rows.map((row) => (
            <li className="row" key={row.key}>
              <div>
                <div className="row-title">{row.title}</div>
                <div className="row-sub">{row.sub}</div>
              </div>
              <Link className="row-act" to={to} aria-label={`${row.action}: ${row.sub}`}>
                {row.action}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="actions">
        <Link className="btn" to={to}>
          <Icon name="mail" />
          Подготовить письмо
        </Link>
      </div>
    </Fold>
  );
}
