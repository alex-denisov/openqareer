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
  Target,
  UserCircle,
} from '@phosphor-icons/react';
import { BrandMark } from '../brand/BrandMark';
import type { AuthUser } from '../coach/coachApi';

interface LandingPageProps {
  session?: AuthUser | null;
  onNavigate: (path: string) => void;
}

const FAQ_ITEMS = [
  {
    question: 'Что я получу после карьерной диагностики?',
    answer:
      'Профиль по фактам, рабочую гипотезу целевой роли, видимые пробелы и один следующий шаг с объяснением причины.',
  },
  {
    question: 'Как добавить профиль LinkedIn или резюме hh.ru?',
    answer:
      'Прямой импорт LinkedIn и hh.ru работает в десктопном приложении через вашу собственную сессию. На сайте можно загрузить резюме в PDF.',
  },
  {
    question: 'Сколько это стоит?',
    answer:
      'Базовый тариф бесплатен и не ограничен по сроку. Покупка подписки и автоматизация внешних аккаунтов в продукте пока не подключены.',
  },
  {
    question: 'OpenQareer гарантирует интервью или оффер?',
    answer:
      'Нет. Платформа помогает проверить карьерное решение и подготовить следующий шаг, но не принимает решение за работодателя.',
  },
  {
    question: 'Могу ли я удалить или выгрузить свои данные?',
    answer:
      'Да. В настройках аккаунта доступны экспорт данных и удаление аккаунта вместе с сохранёнными данными.',
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
        'Карьерная операционная система кандидата: профиль по фактам, диагностика и один следующий шаг.',
    },
    {
      '@type': 'SoftwareApplication',
      '@id': 'https://openqareer.com/#application',
      name: 'OpenQareer',
      url: 'https://openqareer.com',
      description:
        'Бесплатный доступ к загрузке резюме, проверке карьерных фактов, диагностике и выбору следующего действия.',
      operatingSystem: 'Web, desktop companion',
      applicationCategory: 'BusinessApplication',
      inLanguage: 'ru-RU',
      isAccessibleForFree: true,
      audience: {
        '@type': 'Audience',
        audienceType: 'Кандидаты, которые ищут работу или проверяют карьерное направление',
      },
      featureList: [
        'Загрузка резюме в PDF',
        'Импорт профиля LinkedIn через десктопное приложение',
        'Импорт резюме hh.ru через десктопное приложение',
        'Профиль по фактам',
        'Карьерная диагностика',
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
    desc: 'Опыт, результаты, навыки и образование из вашего резюме. Каждый импортированный вывод можно проверить.',
  },
  {
    icon: Target,
    title: 'Карьерная диагностика',
    desc: 'Показывает, на какие роли уже есть опора в опыте и каких данных пока не хватает для решения.',
  },
  {
    icon: MagnifyingGlass,
    title: 'Проверка роли на рынке',
    desc: 'Рабочую гипотезу можно сравнить с датированной выборкой вакансий из доступного источника.',
  },
  {
    icon: FileText,
    title: 'Один следующий шаг',
    desc: 'Платформа предлагает одно действие, объясняет его причину и показывает, что изменится после выполнения.',
  },
];

const SERVICES = [
  {
    icon: Compass,
    tag: 'Старт',
    title: 'Импорт опыта',
    desc: 'Загрузите резюме в PDF на сайте или подключите LinkedIn либо hh.ru в десктопном приложении.',
    points: ['Разбор структуры резюме', 'Импорт опыта и образования', 'Видимый результат загрузки'],
  },
  {
    icon: Path,
    tag: 'Профиль',
    title: 'Проверка карьерных фактов',
    desc: 'Просмотрите, подтвердите или исключите выводы, собранные из резюме и диалога.',
    points: ['Опыт и результаты', 'Навыки и образование', 'Неизвестные данные отмечены отдельно'],
  },
  {
    icon: MagnifyingGlass,
    tag: 'Диагностика',
    title: 'Рабочая гипотеза роли',
    desc: 'Диагностика связывает целевую роль с подтверждённым опытом и отдельно называет пробелы.',
    points: ['Основание для роли', 'Ограничения поиска', 'Вопросы, которые меняют решение'],
  },
  {
    icon: FileText,
    tag: 'Резюме',
    title: 'Резюме из подтверждённых данных',
    desc: 'Раздел резюме собирает документ из фактов профиля и показывает, что ещё нужно уточнить.',
    points: ['Опыт и результаты из профиля', 'Видимые пробелы', 'Факты можно исправить до сохранения'],
  },
  {
    icon: ChartLineUp,
    tag: 'Рынок',
    title: 'Датированная выборка вакансий',
    desc: 'Сохранённое направление поиска показывает источник, дату наблюдения и найденные вакансии.',
    points: ['Один поисковый запрос', 'Состояние источника', 'Вакансии с прямыми ссылками'],
  },
  {
    icon: LockKey,
    tag: 'Контроль',
    title: 'Решение остаётся у кандидата',
    desc: 'OpenQareer готовит следующий шаг, но не отправляет отклики и сообщения без вашего явного действия.',
    points: ['Проверка перед внешним действием', 'Экспорт данных из аккаунта', 'Удаление аккаунта и данных'],
  },
];

const STEPS = [
  {
    num: '01',
    title: 'Добавьте резюме',
    desc: 'Загрузите PDF на сайте или импортируйте LinkedIn либо hh.ru через десктопное приложение.',
  },
  {
    num: '02',
    title: 'Проверьте профиль',
    desc: 'OpenQareer соберёт профиль по фактам. Вы подтвердите данные и увидите, что осталось неизвестным.',
  },
  {
    num: '03',
    title: 'Получите диагностику',
    desc: 'Диагностика свяжет опыт, целевую роль, рынок и ограничения без обещаний интервью или оффера.',
  },
  {
    num: '04',
    title: 'Сделайте следующий шаг',
    desc: 'В кабинете появится один следующий шаг с причиной и ожидаемым изменением.',
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
        <button className="site-btn is-admin is-small" type="button" onClick={() => onNavigate('/admin')}>
          Админка
        </button>
      ) : null}
      <div className="site-user-badge">
        <UserCircle size={18} weight="bold" />
        <span className="user-name">{userName}</span>
      </div>
      <button className="site-btn is-primary is-small" type="button" onClick={() => onNavigate('/app')}>
        В кабинет
      </button>
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
        <a href="#features">Что внутри</a>
        <a href="#services">Возможности</a>
        <a href="#how-it-works">Как это работает</a>
        <a href="#tariffs">Тарифы</a>
        <a href="#faq">FAQ</a>
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
            <button className="site-btn is-ghost is-small" type="button" onClick={() => onNavigate('/login')}>
              Войти
            </button>
            <button className="site-btn is-primary is-small" type="button" onClick={() => onNavigate('/signup')}>
              Начать
            </button>
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
        <button className="site-btn is-primary is-large" type="button" onClick={() => onNavigate('/app')}>
          Перейти в рабочий кабинет <ArrowRight size={18} weight="bold" />
        </button>
        {isAdmin ? (
          <button className="site-btn is-admin is-large" type="button" onClick={() => onNavigate('/admin')}>
            Панель администратора
          </button>
        ) : (
          <button className="site-btn is-secondary is-large" type="button" onClick={() => onNavigate('/app')}>
            Мой профиль и аналитика
          </button>
        )}
      </>
    );
  }
  return (
    <>
      <button className="site-btn is-primary is-large" type="button" onClick={() => onNavigate('/signup')}>
        Пройти карьерную диагностику <ArrowRight size={18} weight="bold" />
      </button>
      <button className="site-btn is-secondary is-large" type="button" onClick={() => onNavigate('/login')}>
        Войти в существующий аккаунт
      </button>
    </>
  );
}

function LandingHero({ session, onNavigate }: LandingPageProps) {
  const isAdmin = session?.role === 'admin';

  return (
    <section className="site-hero" aria-labelledby="hero-heading">
      <div className="site-badge">
        <ShieldCheck size={16} weight="fill" /> Бесплатный доступ
      </div>
      <h1 id="hero-heading" className="site-hero-title">
        Карьерная операционная система кандидата
      </h1>
      <p className="site-hero-lead">
        Загрузите резюме в PDF или подключите hh.ru в десктопном приложении.
        OpenQareer соберёт профиль по фактам, проведёт карьерную диагностику и
        предложит один следующий шаг с объяснением причины.
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
        <span className="dot" /> Ранняя версия: регистрация доступна без приглашения
      </div>
      <div className="site-guarantee-pill">
        <span className="dot" /> Внешние действия — только после вашего подтверждения
      </div>
      <div className="site-guarantee-pill">
        <span className="dot" /> Выводы показывают факты и неизвестные данные
      </div>
    </section>
  );
}

function LandingPillars() {
  return (
    <section id="features" className="site-section" aria-labelledby="pillars-heading">
      <header className="site-section-header">
        <span className="site-section-eyebrow">Результат для кандидата</span>
        <h2 id="pillars-heading" className="site-section-title">От резюме к следующему действию</h2>
        <p className="site-section-lead">Четыре части одного проверяемого карьерного решения.</p>
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
        <h2 id="services-heading" className="site-section-title">Функции текущей версии</h2>
        <p className="site-section-lead">Только доступные сейчас действия и результаты.</p>
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
        <span className="site-section-eyebrow">Путь кандидата</span>
        <h2 id="how-heading" className="site-section-title">Как работает OpenQareer</h2>
        <p className="site-section-lead">Каждый этап даёт видимый результат и следующий переход.</p>
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
  onAction,
}: {
  buttonLabel: string;
  onAction: () => void;
}) {
  return (
    <article className="site-tariff-card">
      <div className="site-tariff-header">
        <h3>Самостоятельный</h3>
        <p className="site-tariff-price">0 ₽ <span>/ без срока</span></p>
        <p className="site-tariff-desc">Основной путь кандидата открыт каждому, кто завёл аккаунт.</p>
      </div>
      <ul className="site-tariff-features">
        <li><CheckCircle size={18} weight="fill" /> Загрузка резюме в PDF</li>
        <li><CheckCircle size={18} weight="fill" /> Импорт hh.ru в десктопном приложении</li>
        <li><CheckCircle size={18} weight="fill" /> Профиль с проверкой фактов</li>
        <li><CheckCircle size={18} weight="fill" /> Карьерная диагностика</li>
        <li><CheckCircle size={18} weight="fill" /> Один объяснимый следующий шаг</li>
      </ul>
      <button className="site-btn is-secondary is-full" type="button" onClick={onAction}>
        {buttonLabel}
      </button>
    </article>
  );
}

function FeaturedTariffCard({
  buttonLabel,
  onAction,
}: {
  buttonLabel: string;
  onAction: () => void;
}) {
  return (
    <article className="site-tariff-card is-featured">
      <div className="site-tariff-header">
        <h3>Сопровождение</h3>
        <p className="site-tariff-price">Не подключено <span>/ в продукте</span></p>
        <p className="site-tariff-desc">Ручное сопровождение обсуждается отдельно после проверки основного пути.</p>
      </div>
      <ul className="site-tariff-features">
        <li><CheckCircle size={18} weight="fill" /> Ручной разбор результатов диагностики</li>
        <li><CheckCircle size={18} weight="fill" /> Уточнение роли и ограничений поиска</li>
        <li><CheckCircle size={18} weight="fill" /> Подготовка плана следующего шага</li>
        <li><CheckCircle size={18} weight="fill" /> Без автоматических действий во внешних аккаунтах</li>
      </ul>
      <button className="site-btn is-primary is-full" type="button" onClick={onAction}>
        {buttonLabel}
      </button>
    </article>
  );
}

function LandingTariffs({ session, onNavigate }: LandingPageProps) {
  const targetAction = session ? () => onNavigate('/app') : () => onNavigate('/signup');
  const primaryButtonLabel = session ? 'Вернуться к диагностике' : 'Сначала пройти диагностику';
  const freeButtonLabel = session ? 'Перейти в кабинет' : 'Создать аккаунт';

  return (
    <section id="tariffs" className="site-section" aria-labelledby="tariffs-heading">
      <header className="site-section-header">
        <span className="site-section-eyebrow">Доступ и цены</span>
        <h2 id="tariffs-heading" className="site-section-title">Тарифы</h2>
        <p className="site-section-lead">Базовый тариф бесплатен и не ограничен по сроку. Регистрация доступна без приглашения. Покупка подписки в продукте пока не подключена.</p>
      </header>
      <div className="site-tariffs-grid">
        <FreeTariffCard buttonLabel={freeButtonLabel} onAction={targetAction} />
        <FeaturedTariffCard buttonLabel={primaryButtonLabel} onAction={targetAction} />
      </div>
    </section>
  );
}

function LandingFaq() {
  return (
    <section id="faq" className="site-section" aria-labelledby="faq-heading">
      <header className="site-section-header">
        <span className="site-section-eyebrow">Вопросы и ответы</span>
        <h2 id="faq-heading" className="site-section-title">Часто задаваемые вопросы</h2>
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
        <h2 id="cta-heading">Начните с резюме и одного карьерного вопроса</h2>
        <p>
          Соберите профиль по фактам, проверьте рабочую роль и получите следующий
          шаг, который можно выполнить и оценить.
        </p>
        <button
          className="site-btn is-primary is-large"
          type="button"
          onClick={() => (session ? onNavigate('/app') : onNavigate('/signup'))}
        >
          {session ? 'Перейти в кабинет' : 'Создать аккаунт'} <ArrowRight size={18} weight="bold" />
        </button>
      </div>
    </section>
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
          <p>Профиль по фактам, диагностика и один следующий шаг.</p>
          <span className="site-copyright">
            &copy; {new Date().getFullYear()} OpenQareer. Все права защищены.
          </span>
        </div>
        <div className="site-footer-links">
          <div className="link-group">
            <strong>Продукт</strong>
            <a href="#features">Что внутри</a>
            <a href="#services">Возможности</a>
            <a href="#tariffs">Тарифы</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="link-group">
            <strong>Доступ</strong>
            <button className="link-btn" type="button" onClick={() => onNavigate('/login')}>Вход</button>
            <button className="link-btn" type="button" onClick={() => onNavigate('/signup')}>Регистрация</button>
            {session?.role === 'admin' ? (
              <button className="link-btn" type="button" onClick={() => onNavigate('/admin')}>Админка</button>
            ) : null}
          </div>
        </div>
      </div>
    </footer>
  );
}

export function LandingPage({ session, onNavigate }: LandingPageProps) {
  React.useEffect(() => {
    document.title = 'OpenQareer · Карьерная операционная система кандидата';
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
