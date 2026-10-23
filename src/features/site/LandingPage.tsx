import React from 'react';
import { AppleLogo, Check } from '@phosphor-icons/react';
import type { AuthUser } from '../coach/coachApi';
import {
  LANDING_STATS_SCRIPT_ID,
  LANDING_STATS_SNAPSHOT,
  LANDING_TOKENS,
  formatPoolCount,
  formatPoolDate,
  sourcesWord,
  type LandingStats,
} from '../../../shared/landingStats';
import { DESKTOP_DOWNLOAD_PATH } from './DesktopDownload';
import { SiteLink } from './SiteLink';
import { capturedLandingStats } from './embeddedLandingStats';
import { preloadAuthPages } from './authPagesLoader';
import { FaqAnswer, PublicFooter, PublicHeader } from './PublicSiteChrome';
import {
  CONTROL_POINTS,
  LANDING_FAQ_IDS,
  LANDING_TARIFFS,
  PIPELINE,
  faqItemById,
} from './publicSiteContent';
import { landingStructuredData } from './publicSiteStructuredData';
import { LANDING_TITLE } from './siteTitles';

interface LandingPageProps {
  readonly session?: AuthUser | null;
  readonly onNavigate: (path: string) => void;
  /**
   * Pool numbers and featured vacancies. The prerenderer passes tokens the
   * server replaces; in the browser the page reads the snapshot the server
   * embedded, so hydration shows the same text.
   */
  readonly stats?: LandingStats;
}

export const LANDING_HERO_TITLE = 'Ваш опыт стоит больше, чем видно в резюме';

/** Snapshot embedded by the server; the real 20.10 reading otherwise. */
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
    sources: tokens ? LANDING_TOKENS.sources : String(stats.sourceCount),
    sourcesWord: tokens ? LANDING_TOKENS.sourcesWord : sourcesWord(stats.sourceCount),
    remote: tokens ? LANDING_TOKENS.remote : formatPoolCount(stats.remoteCount),
    date: tokens ? LANDING_TOKENS.date : formatPoolDate(stats.updatedAt),
    json: tokens ? LANDING_TOKENS.json : JSON.stringify(stats).replace(/</gu, '\\u003c'),
  };
}

function CtaLink({
  to,
  className,
  children,
  onNavigate,
}: {
  readonly to: string;
  readonly className: string;
  readonly children: React.ReactNode;
  readonly onNavigate: (path: string) => void;
}) {
  return (
    <SiteLink to={to} className={className} onNavigate={onNavigate} onWarm={preloadAuthPages}>
      {children}
    </SiteLink>
  );
}

type Counts = ReturnType<typeof counts>;

function PoolFacts({ c }: { c: Counts }) {
  return (
    <div className="ps-facts">
      <span>
        <b>{c.active}</b> записей вакансий
      </span>
      <span>
        <b>{c.sources}</b> {c.sourcesWord}
      </span>
      <span>
        <b>{c.remote}</b> удалённых записей
      </span>
      <small>
        Пул openqareer, обновлено {c.date}. Одна вакансия может встречаться в нескольких источниках.
      </small>
    </div>
  );
}

function VacancyBoard({ stats, c }: { stats: LandingStats; c: Counts }) {
  return (
    <div className="ps-board" aria-label="Удалённые вакансии из пула">
      <div className="ps-board-head">
        <h2>Удалённая работа: {c.remote} записей в пуле</h2>
        <span>зарплата</span>
      </div>
      {stats.vacancies.map((vacancy, index) => (
        <div className="ps-job" key={index}>
          <span className="ps-job-title">{vacancy.title}</span>
          <span className="ps-job-salary">{vacancy.salary}</span>
          <span className="ps-chip">{vacancy.country}</span>
        </div>
      ))}
      <div className="ps-board-foot">
        Процент совпадения появится после загрузки резюме.{' '}
        <a href="/vacancies/remote">Все удалённые вакансии →</a>
      </div>
    </div>
  );
}

function HeroCopy({
  onNavigate,
  signedIn,
}: {
  onNavigate: (p: string) => void;
  signedIn: boolean;
}) {
  return (
    <>
      <p className="ps-label">Сервис для поиска работы с ИИ</p>
      <h1 id="hero-heading">
        Ваш опыт стоит больше, <span>чем видно в резюме</span>
      </h1>
      <p className="ps-lead">
        openqareer помогает в поиске работы специалистам и руководителям: ИИ соберёт профиль из
        резюме, проверит его на ATS и подберёт вакансии из сотен источников с зарплатой и процентом
        совпадения.
      </p>
      <div className="ps-cta">
        <CtaLink
          to={signedIn ? '/app' : '/signup'}
          className="ps-btn is-primary is-lg"
          onNavigate={onNavigate}
        >
          {signedIn ? 'Открыть кабинет' : 'Найти работу'}
        </CtaLink>
        <CtaLink to="/signup" className="ps-btn is-lg" onNavigate={onNavigate}>
          Подобрать вакансии
        </CtaLink>
      </div>
      <p className="ps-fine">
        Профиль в openqareer видите только вы; откликов без вашего одобрения нет.
      </p>
      <a className="ps-dl-link" href="#download">
        <AppleLogo size={16} weight="fill" aria-hidden="true" />
        <span>Скачать приложение</span>
      </a>
    </>
  );
}

function Hero({
  stats,
  onNavigate,
  signedIn,
}: {
  stats: LandingStats;
  onNavigate: (p: string) => void;
  signedIn: boolean;
}) {
  const c = counts(stats);
  return (
    <section className="ps-hero" aria-labelledby="hero-heading">
      <div className="ps-wrap ps-hero-grid">
        <div>
          <HeroCopy onNavigate={onNavigate} signedIn={signedIn} />
          <PoolFacts c={c} />
        </div>
        <VacancyBoard stats={stats} c={c} />
      </div>
      <script
        type="application/json"
        id={LANDING_STATS_SCRIPT_ID}
        dangerouslySetInnerHTML={{ __html: c.json }}
      />
    </section>
  );
}

function Pipeline() {
  return (
    <section className="ps-section" id="how" aria-labelledby="how-heading">
      <div className="ps-wrap">
        <div className="ps-sh">
          <div>
            <p className="ps-label">Как это работает</p>
            <h2 id="how-heading">От резюме до оффера по одному маршруту</h2>
          </div>
          <p>Каждый день одно следующее действие и зачем оно.</p>
        </div>
        <ol className="ps-loop">
          {PIPELINE.map((step, index) => (
            <li key={step.title} className={step.done ? 'is-on' : undefined}>
              <span className="ps-loop-n">{String(index + 1).padStart(2, '0')}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
              <div className="ps-loop-who">{step.who}</div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const MATCH_EXAMPLES = [
  {
    title: 'Director Project Management',
    meta: 'США · $160–180 тыс. в год',
    matched: '11 из 13',
    pct: 84,
  },
  {
    title: 'Директор по маркетингу',
    meta: 'Россия · от 250 тыс. ₽ в месяц',
    matched: '9 из 12',
    pct: 75,
  },
  {
    title: 'Director of Talent Automations',
    meta: 'США · $180–250 тыс. в год',
    matched: '6 из 11',
    pct: 55,
  },
] as const;

function MatchSection() {
  return (
    <section className="ps-section" aria-labelledby="match-heading">
      <div className="ps-wrap ps-split">
        <div>
          <p className="ps-label">Вакансии</p>
          <h2 id="match-heading">Подбор вакансий по резюме: сразу видно, на что откликаться</h2>
          <p className="ps-soft">
            Процент считается по требованиям из текста вакансии. В кабинете у каждого процента виден
            список совпавших и недостающих требований.
          </p>
        </div>
        <div className="ps-card">
          <div className="ps-card-head">
            <span>Вакансия</span>
            <span>Совпавшие требования и процент</span>
          </div>
          {MATCH_EXAMPLES.map((row) => (
            <div className="ps-row" key={row.title}>
              <span>
                <b>{row.title}</b>
                <small>{row.meta}</small>
              </span>
              <span className="ps-chip">{row.matched}</span>
              <span className={row.pct >= 70 ? 'ps-pct' : 'ps-pct is-mid'}>{row.pct}</span>
            </div>
          ))}
          <div className="ps-card-foot">Демо-профиль.</div>
        </div>
      </div>
    </section>
  );
}

function CabinetBand() {
  return (
    <section className="ps-band" id="apply" aria-labelledby="band-heading">
      <div className="ps-wrap">
        <p className="ps-label">Кабинет openqareer</p>
        <h2 id="band-heading">Одно решение на день и все отклики в одном месте</h2>
        <div className="ps-band-grid">
          <figure>
            <picture>
              <source media="(max-width: 760px)" type="image/webp" srcSet="/landing/today-m.webp" />
              <source media="(max-width: 760px)" srcSet="/landing/today-m.png" />
              <source type="image/webp" srcSet="/landing/today.webp" />
              <img
                src="/landing/today.png"
                alt="Экран «Сегодня»: следующее решение с причиной и очередь дня"
                width={1960}
                height={1340}
                loading="lazy"
                decoding="async"
              />
            </picture>
            <figcaption>
              <b>Решение на день:</b> причина, ожидаемый эффект и очередь дел. Снимок кабинета,
              демо-профиль.
            </figcaption>
          </figure>
          <figure className="ps-band-side">
            <picture>
              {/* 390: one readable column of the board instead of the whole board. */}
              <source media="(max-width: 760px)" srcSet="/landing/apps-m.png" />
              <source type="image/webp" srcSet="/landing/apps.webp" />
              <img
                src="/landing/apps.png"
                alt="Экран «Отклики»: колонки «Ответили» и «Интервью»"
                width={968}
                height={1480}
                loading="lazy"
                decoding="async"
              />
            </picture>
            <figcaption>
              <b>Отклики.</b> Письмо и резюме у каждого отклика, интервью с датой. Снимок кабинета,
              демо-профиль.
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}

function ControlSection() {
  return (
    <section className="ps-section" aria-labelledby="control-heading">
      <div className="ps-wrap">
        <p className="ps-label">Границы</p>
        <h2 id="control-heading">Что остаётся под вашим контролем</h2>
        <div className="ps-control">
          {CONTROL_POINTS.map((point) => (
            <div key={point.title}>
              <span className="ps-tick" aria-hidden="true">
                <Check size={16} weight="bold" />
              </span>
              <h3>{point.title}</h3>
              <p>{point.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ToolsSection({ remote }: { remote: string }) {
  return (
    <section className="ps-section" id="tools" aria-labelledby="tools-heading">
      <div className="ps-wrap">
        <div className="ps-sh">
          <div>
            <p className="ps-label">Инструменты</p>
            <h2 id="tools-heading">Каталог вакансий без регистрации</h2>
          </div>
          <p>Свежие вакансии по ролям, городам и странам: источник и дата у каждой.</p>
        </div>
        <div className="ps-tools">
          <a className="ps-tool" href="/vacancies">
            <span className="ps-chip is-ok">работает</span>
            <h3>Каталог вакансий</h3>
            <p>
              Открытая часть пула: вакансии по городам и ролям, зарплата, где она указана, дата и
              прямая ссылка на источник. Полный пул и процент совпадения: в кабинете.
            </p>
            <span className="ps-go">Открыть каталог →</span>
          </a>
          <a className="ps-tool" href="/vacancies/remote">
            <span className="ps-chip is-ok">работает</span>
            <h3>Удалённые вакансии</h3>
            <p>
              {remote} удалённых вакансий в пуле, в том числе за рубежом. В каталоге открыта их
              часть: роль, зарплата, источник.
            </p>
            <span className="ps-go">Открыть удалённые →</span>
          </a>
        </div>
        <p className="ps-note">
          В кабинете уже есть сравнение стран и расчёт налогов при переезде.
        </p>
      </div>
    </section>
  );
}

function TariffsSection({ onNavigate }: { onNavigate: (p: string) => void }) {
  return (
    <section className="ps-section" id="tariffs" aria-labelledby="tariffs-heading">
      <div className="ps-wrap">
        <div className="ps-sh">
          <div>
            <p className="ps-label">Тарифы</p>
            <h2 id="tariffs-heading">Начните бесплатно, платите за объём работы</h2>
          </div>
          <p>Платные тарифы помесячно, отмена в один клик.</p>
        </div>
        <div className="ps-tiers">
          {LANDING_TARIFFS.map((tier) => (
            <div key={tier.id} className={tier.recommended ? 'ps-tier is-hl' : 'ps-tier'}>
              <span className="ps-tier-name">
                {tier.name}
                {tier.recommended ? <span className="ps-chip is-blue">рекомендуем</span> : null}
              </span>
              <span className="ps-tier-sub">{tier.sub}</span>
              <span className={tier.id === 'exec' ? 'ps-tier-price is-long' : 'ps-tier-price'}>
                {tier.price}
              </span>
              <span className="ps-tier-term">{tier.term}</span>
              <span className="ps-tier-blurb">{tier.blurb}</span>
              <CtaLink
                to={tier.action.href}
                className={tier.recommended ? 'ps-btn is-primary' : 'ps-btn'}
                onNavigate={onNavigate}
              >
                {tier.action.label}
              </CtaLink>
            </div>
          ))}
        </div>
        <p className="ps-note">
          Ещё в продукте: путь в компанию через знакомых, карьерный консультант с памятью
          разговоров, карьерный дневник. Полное сравнение в кабинете.
        </p>
      </div>
    </section>
  );
}

function LandingFaq({ onNavigate }: { onNavigate: (p: string) => void }) {
  const items = LANDING_FAQ_IDS.map(faqItemById);
  const half = Math.ceil(items.length / 2);
  return (
    <section className="ps-section" id="faq" aria-labelledby="faq-heading">
      <div className="ps-wrap">
        <p className="ps-label">Вопросы</p>
        <h2 id="faq-heading">Перед регистрацией</h2>
        <div className="ps-faq">
          {[items.slice(0, half), items.slice(half)].map((column, columnIndex) => (
            <div key={columnIndex}>
              {column.map((item, index) => (
                <details key={item.id} open={columnIndex === 0 && index === 0}>
                  <summary>{item.question}</summary>
                  <FaqAnswer text={item.answer} links={item.links} />
                </details>
              ))}
            </div>
          ))}
        </div>
        <p className="ps-note">
          <SiteLink to="/faq" className="ps-strong-link" onNavigate={onNavigate}>
            Все вопросы и ответы →
          </SiteLink>
        </p>
      </div>
    </section>
  );
}

function DownloadSection() {
  return (
    <section className="ps-section" id="download" aria-labelledby="download-heading">
      <div className="ps-wrap ps-dl">
        <div>
          <p className="ps-label">Приложение для компьютера</p>
          <h2 id="download-heading">Площадки и отклики в одном окне</h2>
          <p className="ps-soft">
            Подключите профили на hh.ru, LinkedIn и других площадках и ведите отклики из приложения.
            Кабинет тот же, что на сайте.
          </p>
        </div>
        <div className="ps-dl-card">
          <a className="ps-mac-badge" href={DESKTOP_DOWNLOAD_PATH} download>
            <AppleLogo size={22} weight="fill" aria-hidden="true" />
            <span>
              <small>Скачать для</small>macOS
            </span>
          </a>
          <p className="ps-dl-meta">Версия 1.0.0 · 36,5 МБ · Windows: в разработке.</p>
          <p className="ps-dl-links">
            <a href="/faq#mac-install">Как установить</a>
            <a href="/faq#windows">Про Windows</a>
          </p>
        </div>
      </div>
    </section>
  );
}

function FinalSection({
  onNavigate,
  signedIn,
}: {
  onNavigate: (p: string) => void;
  signedIn: boolean;
}) {
  return (
    <section className="ps-final" aria-labelledby="final-heading">
      <div className="ps-wrap ps-final-grid">
        <div>
          <h2 id="final-heading">Узнайте, на какие вакансии вы подходите</h2>
          <p>Профиль, роли и подходящие вакансии появятся в кабинете после загрузки.</p>
        </div>
        <div className="ps-cta">
          <CtaLink
            to={signedIn ? '/app' : '/signup'}
            className="ps-btn is-primary is-lg"
            onNavigate={onNavigate}
          >
            {signedIn ? 'Открыть кабинет' : 'Загрузить резюме бесплатно'}
          </CtaLink>
          {signedIn ? null : (
            <CtaLink to="/login" className="ps-btn is-lg" onNavigate={onNavigate}>
              Войти
            </CtaLink>
          )}
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
      <main id="main">
        <Hero stats={current} onNavigate={onNavigate} signedIn={signedIn} />
        <Pipeline />
        <MatchSection />
        <CabinetBand />
        <ControlSection />
        <ToolsSection remote={counts(current).remote} />
        <TariffsSection onNavigate={onNavigate} />
        <LandingFaq onNavigate={onNavigate} />
        <DownloadSection />
        <FinalSection onNavigate={onNavigate} signedIn={signedIn} />
      </main>
      <PublicFooter onNavigate={onNavigate} onLanding signedIn={signedIn} />
    </div>
  );
}
