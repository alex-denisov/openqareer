import React from 'react';
import {
  ArrowRight,
  AppleLogo,
  Calculator,
  ChatCircleText,
  FileText,
  Globe,
  ListBullets,
  Target,
  WindowsLogo,
} from '@phosphor-icons/react';
import type { AuthUser } from '../coach/coachApi';
import {
  LANDING_NAMED_SOURCES,
  LANDING_STATS_SCRIPT_ID,
  LANDING_STATS_SNAPSHOT,
  LANDING_TOKENS,
  formatPoolCount,
  formatPoolDate,
  landingFeed,
  type LandingStats,
} from '../../../shared/landingStats';
import { DESKTOP_DOWNLOAD_PATH, WINDOWS_DOWNLOAD_PATH } from './DesktopDownload';
import { SiteLink } from './SiteLink';
import { capturedLandingStats } from './embeddedLandingStats';
import { preloadAuthPages } from './authPagesLoader';
import { FaqAnswer, PublicFooter, PublicHeader } from './PublicSiteChrome';
import { LandingFeed } from './LandingFeed';
import { LandingTiers } from './LandingTiers';
import { HOME_FAQ, HOME_TOOLS, HOW_STEPS, type ToolIcon } from './landingHomeContent';
import { landingStructuredData } from './publicSiteStructuredData';
import { LANDING_TITLE } from './siteTitles';

interface LandingPageProps {
  readonly session?: AuthUser | null;
  readonly onNavigate: (path: string) => void;
  /**
   * Pool numbers and the vacancy feed. The prerenderer passes tokens the
   * server replaces; in the browser the page reads the snapshot the server
   * embedded, so hydration shows the same text.
   */
  readonly stats?: LandingStats;
}

export const LANDING_HERO_TITLE = 'Вы выбираете работу. Резюме, поиск и отклики — на нас';

/** Snapshot embedded by the server; the last approved reading otherwise. */
export function readEmbeddedLandingStats(): LandingStats {
  if (typeof document === 'undefined') return LANDING_STATS_SNAPSHOT;
  const captured = capturedLandingStats();
  if (captured) return captured;
  const node = document.getElementById(LANDING_STATS_SCRIPT_ID);
  try {
    const parsed = node?.textContent ? (JSON.parse(node.textContent) as LandingStats) : null;
    return parsed && Array.isArray(parsed.vacancies) ? parsed : LANDING_STATS_SNAPSHOT;
  } catch {
    return LANDING_STATS_SNAPSHOT;
  }
}

function counts(stats: LandingStats) {
  const tokens = stats.activeCount < 0;
  return {
    active: tokens ? LANDING_TOKENS.active : formatPoolCount(stats.activeCount),
    more: tokens
      ? LANDING_TOKENS.sourcesMore
      : String(Math.max(stats.sourceCount - LANDING_NAMED_SOURCES, 0)),
    date: tokens ? LANDING_TOKENS.date : formatPoolDate(stats.updatedAt),
    json: tokens ? LANDING_TOKENS.json : JSON.stringify(stats).replace(/</gu, '\\u003c'),
  };
}

type Navigate = (path: string) => void;

function Cta({
  to,
  className,
  onNavigate,
  children,
}: {
  readonly to: string;
  readonly className: string;
  readonly onNavigate: Navigate;
  readonly children: React.ReactNode;
}) {
  return (
    <SiteLink to={to} className={className} onNavigate={onNavigate} onWarm={preloadAuthPages}>
      {children}
    </SiteLink>
  );
}

/**
 * B577: both variants are in the markup and CSS shows one by the
 * `data-oq-signed-in` mark on <html>, so the session answer never redraws it.
 */
function SessionCta({ onNavigate }: { readonly onNavigate: Navigate }) {
  return (
    <>
      <Cta to="/signup?from=home" className="btn primary lg ps-guest" onNavigate={onNavigate}>
        Найти работу
      </Cta>
      <Cta to="/app" className="btn primary lg ps-member" onNavigate={onNavigate}>
        Открыть кабинет
      </Cta>
    </>
  );
}

function AppBadges() {
  return (
    <>
      <a className="macbadge" href={DESKTOP_DOWNLOAD_PATH} download>
        <AppleLogo className="apl" weight="fill" aria-hidden="true" />
        <span>
          <small>Скачать для</small>macOS
        </span>
      </a>
      <a className="macbadge" href={WINDOWS_DOWNLOAD_PATH} download>
        <WindowsLogo className="apl" weight="fill" aria-hidden="true" />
        <span>
          <small>Скачать для</small>Windows
        </span>
      </a>
    </>
  );
}

function Count({ active, date }: { readonly active: string; readonly date: string }) {
  return (
    <p className="count">
      <b>{active}</b> вакансий <span className="dt">· обновлено {date}</span>
    </p>
  );
}

function Hero({
  stats,
  onNavigate,
}: {
  readonly stats: LandingStats;
  readonly onNavigate: Navigate;
}) {
  const c = counts(stats);
  const pool = landingFeed(stats);
  return (
    <section className="scr hero" aria-labelledby="hero-heading">
      <div className="wrap">
        <div>
          <h1 id="hero-heading">
            Вы выбираете работу. <span>Резюме, поиск и отклики — на нас</span>
          </h1>
          <p className="lead">
            Поиск работы с ИИ: openqareer соберёт сильное резюме из вашего опыта, найдёт свежие
            вакансии по всему рынку и откликнется по вашим правилам.
          </p>
          <div className="cta">
            <SessionCta onNavigate={onNavigate} />
            <a className="btn lg" href="/vacancies">
              Смотреть вакансии
            </a>
          </div>
          <div className="app">
            <AppBadges />
          </div>
          <Count active={c.active} date={c.date} />
        </div>
        <LandingFeed pool={pool} more={c.more} />
      </div>
      <script
        type="application/json"
        id={LANDING_STATS_SCRIPT_ID}
        dangerouslySetInnerHTML={{ __html: c.json }}
      />
    </section>
  );
}

function How({ onNavigate }: { onNavigate: Navigate }) {
  return (
    <section className="scr" id="how" aria-labelledby="how-heading">
      <div className="wrap">
        <div className="sh one">
          <div>
            <span className="label">Как это работает</span>
            <h2 id="how-heading">От резюме до оффера в одном месте</h2>
            <p className="lead hide-m">Вы задаёте цель и правила, openqareer ищет и откликается.</p>
          </div>
        </div>
        <ol className="how">
          {HOW_STEPS.map(([title, text], index) => (
            <li key={title}>
              <span className="n">{String(index + 1).padStart(2, '0')}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
        <div className="after">
          <SessionCta onNavigate={onNavigate} />
          <a className="link" href="#tariffs">
            Что входит в тарифы <ArrowRight className="ic" aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  );
}

const TOOL_ICONS: Record<ToolIcon, React.ElementType> = {
  list: ListBullets,
  calc: Calculator,
  target: Target,
  doc: FileText,
  chat: ChatCircleText,
  globe: Globe,
};

function Tools() {
  return (
    <section className="scr" id="tools" aria-labelledby="tools-heading">
      <div className="wrap">
        <div className="sh">
          <div>
            <span className="label">Без регистрации</span>
            <h2 id="tools-heading">Бесплатные инструменты для поиска работы</h2>
          </div>
          <p>Открыты всем. С профилем в openqareer они считают уже под вас.</p>
        </div>
        <div className="tools">
          {HOME_TOOLS.map((tool) => {
            const Icon = TOOL_ICONS[tool.icon];
            return (
              <a className="tool" href={tool.href} key={tool.href}>
                <span className="ib">
                  <Icon size={22} aria-hidden="true" />
                </span>
                <h3>
                  {tool.title}
                  <ArrowRight className="ic" aria-hidden="true" />
                </h3>
                <p>{tool.text}</p>
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Tariffs() {
  return (
    <section className="scr" id="tariffs" aria-labelledby="tariffs-heading">
      <div className="wrap">
        <div className="sh">
          <div>
            <span className="label">Тарифы</span>
            <h2 id="tariffs-heading">Выберите, сколько работы отдать openqareer</h2>
          </div>
          <p>
            <a className="link" href="/tariffs">
              Сравнить тарифы подробно <ArrowRight className="ic" aria-hidden="true" />
            </a>
          </p>
        </div>
        <LandingTiers />
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section className="scr" id="faq" aria-labelledby="faq-heading">
      <div className="wrap">
        <div className="sh">
          <div>
            <span className="label">Вопросы</span>
            <h2 id="faq-heading">Частые вопросы</h2>
          </div>
          <p>
            <a className="link" href="/faq">
              Все вопросы и ответы <ArrowRight className="ic" aria-hidden="true" />
            </a>
          </p>
        </div>
        <div className="faq">
          {HOME_FAQ.map((column, columnIndex) => (
            <div key={columnIndex}>
              {column.map((item) => (
                <details className="q" key={item.question}>
                  <summary>{item.question}</summary>
                  <div className="a">
                    <FaqAnswer text={item.answer} links={item.links} />
                  </div>
                </details>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function End({ onNavigate }: { onNavigate: Navigate }) {
  return (
    <section className="scr end" aria-labelledby="end-heading">
      <div className="wrap">
        <div>
          <h2 id="end-heading">Ваша следующая работа может быть уже в списке</h2>
          <p>Загрузите резюме и посмотрите, куда вы проходите прямо сейчас.</p>
          <div className="cta">
            <SessionCta onNavigate={onNavigate} />
            <a className="btn lg" href="/vacancies">
              Смотреть вакансии
            </a>
          </div>
          <div className="getapp" id="download">
            <AppBadges />
            <p>Больше функций доступно в приложении</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function LandingPage({ session, onNavigate, stats }: LandingPageProps) {
  const [current] = React.useState<LandingStats>(() => stats ?? readEmbeddedLandingStats());
  const signedIn = Boolean(session);
  React.useEffect(() => {
    document.title = LANDING_TITLE;
  }, []);

  return (
    <div className="ps">
      <a className="ps-skip" href="#main">
        К содержимому
      </a>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(landingStructuredData()).replace(/</gu, '\\u003c'),
        }}
      />
      <PublicHeader
        onNavigate={onNavigate}
        onLanding
        signedIn={signedIn}
        isAdmin={session?.role === 'admin'}
      />
      <main id="main" className="hm">
        <Hero stats={current} onNavigate={onNavigate} />
        <How onNavigate={onNavigate} />
        <Tools />
        <Tariffs />
        <Faq />
        <End onNavigate={onNavigate} />
      </main>
      <PublicFooter onNavigate={onNavigate} onLanding signedIn={signedIn} />
    </div>
  );
}
