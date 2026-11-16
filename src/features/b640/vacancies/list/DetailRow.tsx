import { useEffect, useId, useState } from 'react';
import { vacancyFitMark } from '../../../vacancies/vacancyFitModel';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import { formatCompensationCompact } from '../../../vacancies/vacancyCompensation';
import { companyLookupKey } from '../../../vacancies/vacancyScreenCollections';
import { getVacancyConnectionCircles } from '../../../vacancies/vacancyLetterApi';
import { Icon, Link } from '../../kit';
import { buildNodePath } from '../../routes';
import { BarPart } from '../Bar';
import { moneyView } from '../format';
import type { RowEnv } from './VacancyRow';

function SourceTip({ label, text }: { label: string; text: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className="v4-src">
      <button className="icon-btn info" type="button" aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        <Icon name="info" />
      </button>
      <span className="v4-pop" id={id} role="note" hidden={!open}>
        {text}
      </span>
    </span>
  );
}

/** Знакомый из первого круга; сбой запроса — без строки. */
function useFriend(clusterId: string): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getVacancyConnectionCircles(clusterId)
      .then((result) => {
        const first = result.circles.find((circle) => circle.circle === 1 && circle.state === 'available');
        const known = first?.paths.find((path) => path.source !== 'cold');
        const person = known?.recipient.fullName?.trim();
        if (alive) setName(person || null);
      })
      .catch(() => {
        if (alive) setName(null);
      });
    return () => {
      alive = false;
    };
  }, [clusterId]);
  return name;
}

interface Fork {
  readonly start: number;
  readonly size: number;
  readonly caption: string;
}

function marketRange(item: MatchedVacancyItem) {
  const market = item.explanation.marketSalary;
  if (market?.low === undefined || market.high === undefined) return undefined;
  return { low: market.low, high: market.high, currency: market.currency, sample: market.sampleSize, at: market.computedAt };
}

/** Вилка на шкале рынка; считается только при оценке рынка в той же валюте. */
function forkOf(item: MatchedVacancyItem): Fork | undefined {
  const market = marketRange(item);
  if (!market) return undefined;
  const salary = item.cluster.salary;
  const same = salary?.currency && salary.currency === market.currency;
  const from = same ? (salary.from ?? salary.to ?? market.low) : market.low;
  const to = same ? (salary.to ?? salary.from ?? market.high) : market.high;
  const top = Math.max(to, market.high) * 1.25;
  if (!(top > 0)) return undefined;
  const start = (from / top) * 100;
  return {
    start,
    size: Math.max(((to - from) / top) * 100, 2),
    caption: formatCompensationCompact({ from, to, currency: market.currency }),
  };
}

function moneyNote(item: MatchedVacancyItem): string {
  const market = marketRange(item);
  const base = item.cluster.salary ? 'Вилка — из текста вакансии.' : 'В вакансии зарплата не указана.';
  if (!market) return base;
  const range = formatCompensationCompact({ from: market.low, to: market.high, currency: market.currency });
  const day = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(new Date(market.at));
  return `${base} Рынок по роли ${range} — ${market.sample} вакансий с зарплатой, ${day}.`;
}

function FitScale({ item }: { item: MatchedVacancyItem }) {
  const mark = vacancyFitMark(item.explanation.fitView);
  if (mark.kind !== 'number') return null;
  return (
    <div className="vs-sc">
      <span className="vs-k">Совпадение</span>
      <span className="vs-v num">{mark.percent} %</span>
      <span className="vs-bar" role="img" aria-label={`Совпадение ${mark.percent} %`}>
        <BarPart className={`is-${mark.tier}`} size={mark.percent} />
      </span>
      <SourceTip label="Откуда это число" text="Требования из текста вакансии сверены с опытом в профиле: есть в профиле — целиком, частично — наполовину." />
    </div>
  );
}

function MoneyScale({ item, env }: { item: MatchedVacancyItem; env: RowEnv }) {
  const money = moneyView(item, { currency: env.currency, rates: env.rates });
  const fork = forkOf(item);
  return (
    <div className="vs-sc">
      <span className="vs-k">Деньги</span>
      <span className="vs-v num">{money.text}</span>
      {fork ? (
        <span className="vs-bar is-money" role="img" aria-label={`Вилка ${fork.caption}`}>
          <BarPart className="vs-fork" start={fork.start} size={fork.size} />
        </span>
      ) : null}
      <SourceTip label="Откуда это число" text={moneyNote(item)} />
    </div>
  );
}

export interface DetailRowProps {
  readonly item: MatchedVacancyItem;
  readonly env: RowEnv;
}

/** Сводка раскрытой строки (v06b): шкалы, компания, знакомый, «Откликнуться». */
export function DetailRow({ item, env }: DetailRowProps) {
  const { cluster } = item;
  const friend = useFriend(cluster.id);
  const company = cluster.canonicalCompany ?? '';
  const industry = cluster.companyFeatures?.industry;
  return (
    <tr className="vt-detail-row">
      <td colSpan={8}>
        <section className="vd vs" id={`vacancy-details-${cluster.id}`} aria-label={`Сводка: ${cluster.canonicalTitle} · ${company}`}>
          <div className="vs-scales">
            <FitScale item={item} />
            <MoneyScale item={item} env={env} />
          </div>
          <p className="vs-co">
            <Icon name="building" />
            <span>
              <Link className="vt-co" to={buildNodePath('v10b', { companyId: companyLookupKey(company) })}>
                {company}
              </Link>
              {industry ? <> · <span className="vs-co-t">{industry}</span></> : null}
            </span>
          </p>
          {friend ? (
            <p className="vs-fr">
              <Icon name="users" />
              Знакомый: {friend}
            </p>
          ) : null}
          <div className="actions vd-actions vs-acts">
            <Link className="btn is-primary" to={buildNodePath('o02', { responseId: cluster.id })}>
              <Icon name="responses" />
              Откликнуться
            </Link>
            <Link className="row-act vs-open" to={buildNodePath('v04', { vacancyId: cluster.id })} aria-label="Открыть полностью">
              <Icon name="out" />
              <span className="vs-open-t">Открыть полностью</span>
            </Link>
          </div>
        </section>
      </td>
    </tr>
  );
}
