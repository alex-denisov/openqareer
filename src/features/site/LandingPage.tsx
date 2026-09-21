import React from 'react';
import {
  ArrowRight,
  ChartLineUp,
  CheckCircle,
  Compass,
  FileText,
  LockKey,
  MagnifyingGlass,
  Path,
  ShieldCheck,
  SignIn,
  Target,
  UserCircle,
} from '@phosphor-icons/react';
import { BrandMark } from '../brand/BrandMark';
import type { AuthUser } from '../coach/coachApi';
import { SiteLink } from './SiteLink';
import { LANDING_TITLE } from './siteTitles';
import { LEGAL_DOCS, legalPath } from '../../../shared/legalRegistry';

interface LandingPageProps {
  session?: AuthUser | null;
  onNavigate: (path: string) => void;
}

/**
 * Тексты лендинга — по отчёту маркетолога и карьерного консультанта (B236,
 * `docs/v1-release/audits/2026-09-21-copy/`). Аудитория — IT-эксперты и
 * топ-менеджеры, поэтому термины индустрии (ATS, оффер, нетворкинг) остаются;
 * уходят внутренние слова продукта («пул», «выборка», «диагностика») и узкие
 * фразы про одну площадку: площадок много, hh.ru и LinkedIn — только примеры.
 */
export const LANDING_HERO_TITLE = 'Ваш поиск работы под контролем';

const FAQ_ITEMS = [
  {
    question: 'Что я увижу после загрузки резюме?',
    answer:
      'Профиль по фактам с пометками «подтверждено» и «не проверено», названия ролей, которые подтверждаются вашим опытом, вакансии по ним из наших источников и один следующий шаг с объяснением причины.',
  },
  {
    question: 'Как добавить профили с площадок, где я ищу работу?',
    answer:
      'На сайте — загрузите резюме файлом. В приложении для компьютера подключите профили на площадках (LinkedIn, hh.ru и другие) через вашу собственную сессию: пароли в OpenQareer не передаются. Список площадок растёт.',
  },
  {
    question: 'Отправляет ли OpenQareer отклики за меня?',
    answer:
      'Нет. Продукт готовит текст отклика и письма, но отправляете вы сами. Отклик засчитывается в воронку только после вашего подтверждения.',
  },
  {
    question: 'Сколько это стоит?',
    answer:
      'Основной путь бесплатен и без срока. Платные тарифы пока нельзя купить: оплата и автоматические действия на площадках в продукте не подключены.',
  },
  {
    question: 'OpenQareer гарантирует интервью или оффер?',
    answer:
      'Нет. Продукт помогает выбрать роль, увидеть вакансии и подготовить отклик, но решение принимает работодатель. Мы не показываем чисел, которых не измеряем.',
  },
  {
    question: 'Могу ли я выгрузить или удалить свои данные?',
    answer:
      'Да. В аккаунте есть выгрузка всех данных одним файлом и удаление аккаунта вместе со всем, что сохранено.',
  },
] as const;

const STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://openqareer.com/#organization',
      name: 'OpenQareer',
      url: 'https://openqareer.com',
      logo: 'https://openqareer.com/favicon.svg',
      description:
        'Рабочее место кандидата: профиль по фактам, вакансии из десятков источников и один следующий шаг.',
    },
    {
      '@type': 'SoftwareApplication',
      '@id': 'https://openqareer.com/#application',
      name: 'OpenQareer',
      url: 'https://openqareer.com',
      description:
        'Бесплатный доступ к загрузке резюме, подтверждению фактов профиля, вакансиям из десятков источников и выбору следующего шага.',
      operatingSystem: 'Web, desktop companion',
      applicationCategory: 'BusinessApplication',
      inLanguage: 'ru-RU',
      isAccessibleForFree: true,
      audience: {
        '@type': 'Audience',
        audienceType: 'Кандидаты, которые ищут работу или проверяют карьерное направление',
      },
      featureList: [
        'Загрузка резюме файлом',
        'Подключение профилей на площадках (LinkedIn, hh.ru и другие) в приложении для компьютера',
        'Профиль по фактам',
        'Роли с опорой на опыт',
        'Вакансии из десятков источников',
        'Один следующий шаг',
      ],
    },
    {
      '@type': 'FAQPage',
      '@id': 'https://openqareer.com/#faq',
      inLanguage: 'ru-RU',
      mainEntity: FAQ_ITEMS.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.answer,
        },
      })),
    },
  ],
};

const PILLARS = [
  {
    icon: ShieldCheck,
    title: 'Профиль по фактам',
    desc: 'Опыт, результаты, навыки и образование из ваших резюме и профилей на площадках. У каждого пункта видно, откуда он взят, его можно исправить или отклонить.',
  },
  {
    icon: Target,
    title: 'Роли, на которые у вас есть опора',
    desc: 'Показывает, какие названия ролей подтверждаются вашим опытом, а какие пока только гипотеза, и чего не хватает, чтобы решить.',
  },
  {
    icon: MagnifyingGlass,
    title: 'Вакансии по вашей роли из десятков источников',
    desc: 'Для выбранной роли видно, сколько вакансий найдено, в каких источниках и на какую дату — без процентов «соответствия» без основания.',
  },
  {
    icon: FileText,
    title: 'Один следующий шаг на сегодня',
    desc: 'Не список из тридцати советов, а одно действие с причиной и с тем, что изменится после него.',
  },
];

const SERVICES = [
  {
    icon: Compass,
    tag: 'Старт',
    title: 'Соберите профиль из резюме и площадок',
    desc: 'Загрузите резюме файлом или подключите профили на площадках, где вы ищете работу: LinkedIn, hh.ru и другие. Площадок будет больше.',
    points: [
      'Что найдено в резюме — видно по пунктам',
      'Опыт, образование и навыки в одном профиле',
      'Что не удалось прочитать — сказано прямо',
    ],
  },
  {
    icon: Path,
    tag: 'Профиль',
    title: 'Подтвердите или отклоните каждый факт',
    desc: 'Всё, что собрано из резюме, площадок и разговора с консультантом, можно подтвердить, исправить или убрать.',
    points: [
      'Опыт с измеримыми результатами',
      'Навыки и образование',
      'Что не подтверждено — помечено словами',
    ],
  },
  {
    icon: MagnifyingGlass,
    tag: 'Роль',
    title: 'Название роли, которое подтверждается опытом',
    desc: 'Продукт предлагает названия ролей по вашим фактам и помечает, какие из них уже встречаются в вакансиях, а какие пока гипотеза.',
    points: [
      'Чем подтверждается каждая роль',
      'Что ограничивает поиск: география, формат, уровень',
      'Вопросы, ответ на которые изменит выбор',
    ],
  },
  {
    icon: FileText,
    tag: 'Резюме',
    title: 'Резюме, собранное только из подтверждённых фактов',
    desc: 'Основное резюме и вариант под страну собираются из профиля; пустые места видны до сохранения.',
    points: [
      'Опыт и результаты — из профиля',
      'Пробелы видны, а не спрятаны',
      'Правки — до сохранения, не после отправки',
    ],
  },
  {
    icon: ChartLineUp,
    tag: 'Вакансии',
    title: 'Вакансии из десятков источников с честными датами',
    desc: 'Одна таблица: источник, сколько дней вакансия у нас, сколько требований совпало с вашим профилем, зарплата и локация, если источник их отдал.',
    points: [
      'Направления поиска с регулярным сбором',
      'Состояние каждого источника: доступен, ограничен, не отвечает',
      'Прямые ссылки на вакансию на площадке',
    ],
  },
  {
    icon: LockKey,
    tag: 'Контроль',
    title: 'Ничего не уходит без вашего подтверждения',
    desc: 'OpenQareer готовит отклик, письмо и подготовку к интервью, но отправляете вы. Данные можно выгрузить или удалить вместе с аккаунтом.',
    points: [
      'Подтверждение перед каждым внешним действием',
      'Выгрузка всех данных одним файлом',
      'Удаление аккаунта вместе с данными',
    ],
  },
];

const STEPS = [
  {
    num: '01',
    title: 'Добавьте резюме или подключите площадки',
    desc: 'Загрузите резюме файлом или подключите профили на площадках, где вы ищете работу.',
  },
  {
    num: '02',
    title: 'Подтвердите факты',
    desc: 'OpenQareer соберёт профиль по фактам. Вы подтвердите, исправите или уберёте каждый пункт и увидите, что осталось неизвестным.',
  },
  {
    num: '03',
    title: 'Выберите роль и условия',
    desc: 'Продукт предложит названия ролей по вашему опыту и покажет, сколько вакансий по каждой есть в источниках. Вы выберете роль, географию и формат.',
  },
  {
    num: '04',
    title: 'Делайте один шаг в день',
    desc: 'На Главной появится один следующий шаг с причиной, а в «Поиске» — очередь вакансий на сегодня.',
  },
];

function HeaderSessionActions({
  isAdmin,
  userName,
  onNavigate,
}: {
  isAdmin: boolean;
  userName: string;
  onNavigate: (path: string) => void;
}) {
  return (
    <>
      {isAdmin ? (
        <SiteLink to="/admin" className="site-btn is-admin is-small" onNavigate={onNavigate}>
          Администрирование
        </SiteLink>
      ) : null}
      <div className="site-user-badge">
        <UserCircle size={18} weight="bold" />
        <span className="user-name">{userName}</span>
      </div>
      <SiteLink to="/app" className="site-btn is-primary is-small" onNavigate={onNavigate}>
        Открыть кабинет <ArrowRight size={16} weight="bold" aria-hidden="true" />
      </SiteLink>
    </>
  );
}

function LandingHeader({ session, onNavigate }: LandingPageProps) {
  const isAdmin = session?.role === 'admin';
  const userName = session?.displayName || session?.username || 'Кандидат';

  return (
    <header className="site-header">
      <a href="/" onClick={(e) => { e.preventDefault(); onNavigate('/'); }} aria-label="Главная OpenQareer">
        <BrandMark variant="lockup" size={28} />
      </a>
      <nav className="site-nav" aria-label="Разделы сайта">
        <a href="#features">Что вы получите</a>
        <a href="#services">Что уже работает</a>
        <a href="#how-it-works">Четыре шага</a>
        <a href="#tariffs">Тарифы</a>
        <a href="#faq">Вопросы</a>
      </nav>
      <div className="site-header-actions">
        {session ? (
          <HeaderSessionActions
            isAdmin={isAdmin}
            userName={userName}
            onNavigate={onNavigate}
          />
        ) : (
          <>
            <SiteLink to="/login" className="site-btn is-ghost is-small" onNavigate={onNavigate}>
              <SignIn size={16} weight="bold" aria-hidden="true" /> Войти
            </SiteLink>
            <SiteLink to="/signup" className="site-btn is-primary is-small" onNavigate={onNavigate}>
              Создать аккаунт
            </SiteLink>
          </>
        )}
      </div>
    </header>
  );
}

function HeroActionButtons({
  session,
  isAdmin,
  onNavigate,
}: {
  session?: AuthUser | null;
  isAdmin: boolean;
  onNavigate: (path: string) => void;
}) {
  if (session) {
    return (
      <>
        <SiteLink to="/app" className="site-btn is-primary is-large" onNavigate={onNavigate}>
          Открыть кабинет <ArrowRight size={18} weight="bold" aria-hidden="true" />
        </SiteLink>
        {isAdmin ? (
          <SiteLink to="/admin" className="site-btn is-admin is-large" onNavigate={onNavigate}>
            Панель администратора
          </SiteLink>
        ) : (
          <SiteLink to="/app" className="site-btn is-secondary is-large" onNavigate={onNavigate}>
            Открыть профиль
          </SiteLink>
        )}
      </>
    );
  }
  return (
    <>
      <SiteLink to="/signup" className="site-btn is-primary is-large" onNavigate={onNavigate}>
        Собрать профиль из резюме <ArrowRight size={18} weight="bold" aria-hidden="true" />
      </SiteLink>
      <SiteLink to="/login" className="site-btn is-secondary is-large" onNavigate={onNavigate}>
        <SignIn size={18} weight="bold" aria-hidden="true" /> Войти в кабинет
      </SiteLink>
    </>
  );
}

function LandingHero({ session, onNavigate }: LandingPageProps) {
  const isAdmin = session?.role === 'admin';

  return (
    <section className="site-hero" aria-labelledby="hero-heading">
      <div className="site-badge">
        <ShieldCheck size={16} weight="fill" aria-hidden="true" /> Основной путь бесплатен и без срока
      </div>
      {/* Hero — вариант B отчёта маркетолога (решение владельца 2026-09-21):
          контроль и безопасность для аудитории, обжёгшейся на автооткликах. */}
      <h1 id="hero-heading" className="site-hero-title">
        {LANDING_HERO_TITLE}
      </h1>
      <p className="site-hero-lead">
        Один профиль по фактам, одна кампания с ролью, географией и очередью
        откликов, одна таблица вакансий из всех источников. OpenQareer готовит
        отклик и подготовку к интервью, но ничего не отправляет без вашего
        подтверждения.
      </p>
      <div className="site-hero-actions">
        <HeroActionButtons session={session} isAdmin={isAdmin} onNavigate={onNavigate} />
      </div>
    </section>
  );
}

function LandingGuarantees() {
  return (
    <section className="site-guarantees" aria-label="Границы продукта">
      <div className="site-guarantee-pill">
        <span className="dot" /> Ранняя версия: регистрация открыта всем, без приглашения
      </div>
      <div className="site-guarantee-pill">
        <span className="dot" /> Ни одного отклика или сообщения без вашего подтверждения
      </div>
      <div className="site-guarantee-pill">
        <span className="dot" /> Каждый вывод помечен: подтверждено, гипотеза или не проверено
      </div>
    </section>
  );
}

function LandingPillars() {
  return (
    <section id="features" className="site-section" aria-labelledby="pillars-heading">
      <header className="site-section-header">
        <span className="site-section-eyebrow">Что вы получите</span>
        <h2 id="pillars-heading" className="site-section-title">От резюме до отклика — четыре вещи, которые у вас появятся</h2>
        <p className="site-section-lead">Каждый вывод помечен: подтверждено, гипотеза или не проверено.</p>
      </header>
      <div className="site-pillars-grid">
        {PILLARS.map((pillar) => {
          const Icon = pillar.icon;
          return (
            <article key={pillar.title} className="site-pillar-card">
              <div className="site-pillar-icon"><Icon size={28} weight="duotone" /></div>
              <h3>{pillar.title}</h3>
              <p>{pillar.desc}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function LandingServices() {
  return (
    <section id="services" className="site-section is-services" aria-labelledby="services-heading">
      <header className="site-section-header">
        <span className="site-section-eyebrow">Что уже работает</span>
        <h2 id="services-heading" className="site-section-title">Шесть вещей, которые можно сделать сегодня</h2>
        <p className="site-section-lead">Здесь только то, что работает прямо сейчас. Что ещё не подключено — сказано прямо.</p>
      </header>
      <div className="site-services-grid">
        {SERVICES.map((srv) => {
          const Icon = srv.icon;
          return (
            <article key={srv.title} className="site-service-card">
              <div className="site-service-top">
                <span className="site-service-tag">{srv.tag}</span>
                <div className="site-service-icon"><Icon size={24} weight="bold" /></div>
              </div>
              <h3>{srv.title}</h3>
              <p className="site-service-desc">{srv.desc}</p>
              <ul className="site-service-points">
                {srv.points.map((pt) => (
                  <li key={pt}><CheckCircle size={16} weight="fill" /> {pt}</li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function LandingHowItWorks() {
  return (
    <section id="how-it-works" className="site-section" aria-labelledby="how-heading">
      <header className="site-section-header">
        <span className="site-section-eyebrow">Четыре шага</span>
        <h2 id="how-heading" className="site-section-title">От резюме до первого отклика</h2>
        <p className="site-section-lead">После каждого шага видно, что появилось и что делать дальше.</p>
      </header>
      <div className="site-steps-grid">
        {STEPS.map((step) => (
          <div key={step.num} className="site-step-card">
            <span className="site-step-num">{step.num}</span>
            <h3>{step.title}</h3>
            <p>{step.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function FreeTariffCard({
  buttonLabel,
  to,
  onNavigate,
}: {
  buttonLabel: string;
  to: string;
  onNavigate: (path: string) => void;
}) {
  return (
    <article className="site-tariff-card">
      <div className="site-tariff-header">
        <h3>Самостоятельно</h3>
        <p className="site-tariff-price">0 ₽ <span>/ без срока</span></p>
        <p className="site-tariff-desc">Всё, что нужно, чтобы собрать профиль, выбрать роль и работать с вакансиями своими руками.</p>
      </div>
      <ul className="site-tariff-features">
        <li><CheckCircle size={18} weight="fill" aria-hidden="true" /> Загрузка резюме файлом</li>
        <li><CheckCircle size={18} weight="fill" aria-hidden="true" /> Подключение профилей на площадках</li>
        <li><CheckCircle size={18} weight="fill" aria-hidden="true" /> Профиль с подтверждением фактов</li>
        <li><CheckCircle size={18} weight="fill" aria-hidden="true" /> Роли с опорой на ваш опыт</li>
        <li><CheckCircle size={18} weight="fill" aria-hidden="true" /> Вакансии из десятков источников</li>
        <li><CheckCircle size={18} weight="fill" aria-hidden="true" /> Один следующий шаг с причиной</li>
      </ul>
      <SiteLink to={to} className="site-btn is-secondary is-full" onNavigate={onNavigate}>
        {buttonLabel}
      </SiteLink>
    </article>
  );
}

function FeaturedTariffCard({
  buttonLabel,
  to,
  onNavigate,
}: {
  buttonLabel: string;
  to: string;
  onNavigate: (path: string) => void;
}) {
  return (
    <article className="site-tariff-card is-featured">
      <div className="site-tariff-header">
        <h3>С сопровождением</h3>
        <p className="site-tariff-price">Оплата не подключена</p>
        <p className="site-tariff-desc">Разбор результатов и настройка поиска вместе со специалистом. Обсуждается отдельно, после того как вы прошли основной путь.</p>
      </div>
      <ul className="site-tariff-features">
        <li><CheckCircle size={18} weight="fill" aria-hidden="true" /> Разбор вашего профиля и ролей со специалистом</li>
        <li><CheckCircle size={18} weight="fill" aria-hidden="true" /> Уточнение роли, географии и формата</li>
        <li><CheckCircle size={18} weight="fill" aria-hidden="true" /> План на первые недели поиска</li>
        <li><CheckCircle size={18} weight="fill" aria-hidden="true" /> Никаких действий в ваших аккаунтах на площадках</li>
      </ul>
      <SiteLink to={to} className="site-btn is-primary is-full" onNavigate={onNavigate}>
        {buttonLabel}
      </SiteLink>
    </article>
  );
}

function LandingTariffs({ session, onNavigate }: LandingPageProps) {
  const targetPath = session ? '/app' : '/signup';
  const primaryButtonLabel = session ? 'Вернуться в кабинет' : 'Сначала собрать профиль бесплатно';
  const freeButtonLabel = session ? 'Открыть кабинет' : 'Создать бесплатный аккаунт';

  return (
    <section id="tariffs" className="site-section" aria-labelledby="tariffs-heading">
      <header className="site-section-header">
        <span className="site-section-eyebrow">Сколько это стоит</span>
        <h2 id="tariffs-heading" className="site-section-title">Тарифы</h2>
        <p className="site-section-lead">Основной путь бесплатен и без срока. Платные тарифы описаны как ориентир: оплата в продукте пока не подключена, купить их нельзя.</p>
      </header>
      <div className="site-tariffs-grid">
        <FreeTariffCard buttonLabel={freeButtonLabel} to={targetPath} onNavigate={onNavigate} />
        <FeaturedTariffCard buttonLabel={primaryButtonLabel} to={targetPath} onNavigate={onNavigate} />
      </div>
    </section>
  );
}

function LandingFaq() {
  return (
    <section id="faq" className="site-section" aria-labelledby="faq-heading">
      <header className="site-section-header">
        <span className="site-section-eyebrow">Вопросы и ответы</span>
        <h2 id="faq-heading" className="site-section-title">Вопросы перед регистрацией</h2>
      </header>
      <div className="site-faq-list">
        {FAQ_ITEMS.map((item, index) => (
          <details className="site-faq-item" open={index === 0} key={item.question}>
            <summary>{item.question}</summary>
            <div className="site-faq-answer">{item.answer}</div>
          </details>
        ))}
      </div>
    </section>
  );
}

function LandingCta({ session, onNavigate }: LandingPageProps) {
  return (
    <section className="site-cta" aria-labelledby="cta-heading">
      <div className="site-cta-inner">
        <h2 id="cta-heading">Начните с резюме — остальное появится в кабинете</h2>
        <p>
          Профиль по фактам, роли с опорой на опыт, вакансии из десятков
          источников и один следующий шаг. Бесплатно и без срока.
        </p>
        <SiteLink
          to={session ? '/app' : '/signup'}
          className="site-btn is-primary is-large"
          onNavigate={onNavigate}
        >
          {session ? 'Открыть кабинет' : 'Создать бесплатный аккаунт'}{' '}
          <ArrowRight size={18} weight="bold" aria-hidden="true" />
        </SiteLink>
      </div>
    </section>
  );
}

function LegalLinkGroup({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <div className="link-group">
      <strong>Документы</strong>
      {LEGAL_DOCS.map((doc) => (
        <SiteLink
          key={doc.slug}
          to={legalPath(doc.slug)}
          className="link-btn"
          onNavigate={onNavigate}
        >
          {doc.navLabel}
        </SiteLink>
      ))}
    </div>
  );
}

function LandingFooter({
  session,
  onNavigate,
}: {
  session?: AuthUser | null;
  onNavigate: (path: string) => void;
}) {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <BrandMark variant="lockup" size={24} />
          <p>Профиль по фактам, вакансии из десятков источников и один следующий шаг.</p>
          <span className="site-copyright">
            &copy; {new Date().getFullYear()} OpenQareer. Все права защищены.
          </span>
        </div>
        <div className="site-footer-links">
          <div className="link-group">
            <strong>Продукт</strong>
            <a href="#features">Что вы получите</a>
            <a href="#services">Что уже работает</a>
            <a href="#tariffs">Тарифы</a>
            <a href="#faq">Вопросы</a>
            {/* Публичный каталог — отдельный документ вне приложения, поэтому
                обычная ссылка, а не переход роутером (B209). Назван каталогом,
                чтобы не путать с разделом кабинета «Вакансии». */}
            <a href="/vacancies">Открытый каталог вакансий</a>
          </div>
          <LegalLinkGroup onNavigate={onNavigate} />
          <div className="link-group">
            <strong>Доступ</strong>
            <SiteLink to="/login" className="link-btn" onNavigate={onNavigate}>Войти</SiteLink>
            <SiteLink to="/signup" className="link-btn" onNavigate={onNavigate}>Создать аккаунт</SiteLink>
            {session?.role === 'admin' ? (
              <SiteLink to="/admin" className="link-btn" onNavigate={onNavigate}>Администрирование</SiteLink>
            ) : null}
          </div>
        </div>
      </div>
    </footer>
  );
}

export function LandingPage({ session, onNavigate }: LandingPageProps) {
  React.useEffect(() => {
    document.title = LANDING_TITLE;
  }, []);

  return (
    <div className="site-layout">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
      />
      <LandingHeader session={session} onNavigate={onNavigate} />
      <main id="main-content">
        <LandingHero session={session} onNavigate={onNavigate} />
        <LandingGuarantees />
        <LandingPillars />
        <LandingServices />
        <LandingHowItWorks />
        <LandingTariffs session={session} onNavigate={onNavigate} />
        <LandingFaq />
        <LandingCta session={session} onNavigate={onNavigate} />
      </main>
      <LandingFooter session={session} onNavigate={onNavigate} />
    </div>
  );
}
