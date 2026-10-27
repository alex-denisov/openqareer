import React from 'react';
import { ArrowRight } from '@phosphor-icons/react';
import type { LandingFeedRow } from '../../../shared/landingStats';
import { HERO_SOURCES } from './landingHomeContent';

export const FEED_TICK_MS = 4500;
export const FEED_SHOWN = 5;

interface ShownRow {
  readonly id: number;
  readonly row: LandingFeedRow;
  readonly fresh: boolean;
}

function initialRows(pool: readonly LandingFeedRow[]): ShownRow[] {
  return pool.slice(0, FEED_SHOWN).map((row, id) => ({ id, row, fresh: false }));
}

/** WCAG 2.2.2: the ticker pauses on hover and focus and has its own button. */
function useFeed(pool: readonly LandingFeedRow[]) {
  const [rows, setRows] = React.useState<readonly ShownRow[]>(() => initialRows(pool));
  const [paused, setPaused] = React.useState(false);
  const [held, setHeld] = React.useState(false);
  const [reduced, setReduced] = React.useState(false);
  const next = React.useRef(FEED_SHOWN);

  React.useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  React.useEffect(() => {
    if (paused || held || reduced || pool.length === 0) return undefined;
    const timer = window.setInterval(() => {
      const index = next.current;
      next.current += 1;
      const row = pool[index % pool.length];
      if (!row) return;
      setRows((current) => [{ id: index, row, fresh: true }, ...current].slice(0, FEED_SHOWN));
    }, FEED_TICK_MS);
    return () => window.clearInterval(timer);
  }, [paused, held, reduced, pool]);

  return { rows, paused, reduced, setPaused, setHeld };
}

export function LandingFeed({
  pool,
  more,
}: {
  readonly pool: readonly LandingFeedRow[];
  /** «320» in «и ещё 320»; a server token while prerendering. */
  readonly more: string;
}) {
  const { rows, paused, reduced, setPaused, setHeld } = useFeed(pool);
  return (
    <div className="feed">
      <div className="src" aria-label="Источники вакансий">
        {HERO_SOURCES.map((name) => (
          <span className="chip" key={name}>
            <i />
            {name}
          </span>
        ))}
        <span className="more">и ещё {more}</span>
      </div>
      <div className="card raised">
        <div className="card-h">
          <b>
            <i aria-hidden="true" />
            Новые вакансии
          </b>
          {reduced ? null : (
            <button
              className="pause"
              type="button"
              aria-pressed={paused}
              onClick={() => setPaused(!paused)}
            >
              {paused ? 'Дальше' : 'Пауза'}
            </button>
          )}
        </div>
        <ul
          className="rows"
          aria-label="Новые вакансии из открытого каталога"
          onMouseEnter={() => setHeld(true)}
          onMouseLeave={() => setHeld(false)}
          onFocus={() => setHeld(true)}
          onBlur={() => setHeld(false)}
        >
          {rows.map(({ id, row, fresh }) => (
            <li key={id} className={fresh ? 'new' : undefined}>
              <a href={row.href}>
                <span className="t">{row.title}</span>
                <span className="s">{row.salary}</span>
                <span className="m">{row.meta}</span>
              </a>
            </li>
          ))}
        </ul>
        <div className="card-f">
          <a className="link" href="/signup?from=home&alert=1">
            Присылать новые по моей профессии
          </a>
          <a className="link" href="/vacancies">
            Все вакансии <ArrowRight className="ic" aria-hidden="true" />
          </a>
        </div>
      </div>
    </div>
  );
}
