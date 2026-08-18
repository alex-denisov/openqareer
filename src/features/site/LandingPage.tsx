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

const STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://openqareer.com/#organization',
      name: 'OpenQareer',
      url: 'https://openqareer.com',
      logo: 'https://openqareer.com/favicon.svg',
      description: 'Candidate-owned career operating system and intelligence platform.',
    },
    {
      '@type': 'SoftwareApplication',
      name: 'OpenQareer Career OS',
      operatingSystem: 'Any',
      applicationCategory: 'BusinessApplication',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'RUB',
      },
    },
  ],
};

const PILLARS = [
  {
    icon: ShieldCheck,
    title: 'Доказательный профиль (Evidence Vault)',
    desc: 'Факты карьеры с подтверждёнными метриками и артефактами. Никаких шаблонных клише или вымышленных достижений.',
  },
  {
    icon: Target,
    title: 'Честная ATS-диагностика',
    desc: 'Многофакторный аудит резюме под требования реальных ATS-систем (РФ и International) с подсветкой критических стоп-факторов.',
  },
  {
    icon: MagnifyingGlass,
    title: 'Мультиисточниковый Smart Radar',
    desc: 'Агрегация и умная дедупликация вакансий с hh.ru, Remotive, Telegram-каналов и карьерных хабов в единую умную ленту.',
  },
  {
    icon: FileText,
    title: 'Resume Studio и точечные отклики',
    desc: 'Генерация резюме и сопроводительных писем под каждую целевую роль на базе исключительно вашего доказанного опыта.',
  },
];

const SERVICES = [
  {
    icon: Compass,
    tag: 'Аудит & Стратегия',
    title: 'Карьерная диагностика и аудит резюме',
    desc: 'Глубокий анализ вашего опыта, выявление сильных сторон, скрытых пробелов и оценка рыночной привлекательности профиля.',
    points: ['ATS-грейдер с объяснением скоринга', 'Анализ пробелов в ключевых навыках', 'Рекомендации по усилению позиционирования'],
  },
  {
    icon: Path,
    tag: 'Целеполагание',
    title: 'Карьерная карта и ролевые гипотезы',
    desc: 'Построение дерева карьерных траекторий, проверка гипотез смежных ролей (Lateral Move, Step-up, Relocation) и оценка требований рынка.',
    points: ['Оценка реалистичности целевых грейдов', 'Анализ зарплатных вилок и динамики спроса', 'Формирование плана закрытия квалификационных разрывов'],
  },
  {
    icon: MagnifyingGlass,
    tag: 'Сбор вакансий',
    title: 'Мультиисточниковый радар возможностей',
    desc: 'Мониторинг рынка труда в реальном времени с автоматической очисткой от дубликатов, компаний-призраков и нерелевантного шума.',
    points: ['Поиск по hh.ru, Telegram-каналам и Remote-хабам', 'Детектор компаний-призраков (Ghost Detector)', 'Умный расчет Match Score с объяснением каждого балла'],
  },
  {
    icon: FileText,
    tag: 'Материалы',
    title: 'Resume Studio & Мастер-профиль',
    desc: 'Управление единым банком подтвержденных карьерных фактов и сборка точечных вариантов резюме в форматах PDF и DOCX.',
    points: ['Master Resume с версионированием фактов', 'Генерация вариантов под РФ и Германию/ЕС', 'Умный конструктор сопроводительных писем'],
  },
  {
    icon: ChartLineUp,
    tag: 'Сопровождение',
    title: 'Воронка откликов и трекинг процессов',
    desc: 'Единый центр управления пайплайном поиска работы: от первого касания до оффера и согласования компенсационного пакета.',
    points: ['Статусы и напоминания о фоллоу-апах', 'Аналитика конверсии по источникам', 'Подготовка к техническим и поведенческим интервью'],
  },
  {
    icon: LockKey,
    tag: 'Безопасность',
    title: 'Защищённый контур и Zero-Surveillance',
    desc: 'Ваши данные принадлежат только вам. Локальное шифрование, отсутствие слежки работодателей и защита от спам-блокировок.',
    points: ['Anti-ban логика при работе с площадками', 'Полный контроль за экспортом и удалением', 'Соответствие стандартам защиты персональных данных'],
  },
];

const STEPS = [
  {
    num: '01',
    title: 'Импорт или аудит опыта',
    desc: 'Загрузите резюме в PDF или подключите профиль — система выделит доказанные факты, роли и метрики.',
  },
  {
    num: '02',
    title: 'Выбор вектора и роли',
    desc: 'Определите целевую роль и рынок (РФ, Релокация, Remote) для формирования персональной карьерной карты.',
  },
  {
    num: '03',
    title: 'Умный поиск вакансий',
    desc: 'Радар агрегирует проверенные вакансии и ранжирует их по степени совпадения с вашим профилем.',
  },
  {
    num: '04',
    title: 'Точечные отклики и трекинг',
    desc: 'Формируйте адаптированные материалы в Resume Studio и ведите прозрачную воронку откликов до оффера.',
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
        <a href="#features">Возможности</a>
        <a href="#services">Экосистема услуг</a>
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
        <ShieldCheck size={16} weight="fill" /> Кандидат-центричная карьерная операционная система
      </div>
      <h1 id="hero-heading" className="site-hero-title">
        Карьерная операционная система кандидата
      </h1>
      <p className="site-hero-lead">
        Управляйте карьерой на основе подтверждённых фактов, честной
        ATS-диагностики резюме, мультиисточникового радара вакансий и умной Resume Studio.
        Никаких галлюцинаций AI, спам-автооткликов или продажи ваших данных работодателям.
      </p>
      <div className="site-hero-actions">
        <HeroActionButtons session={session} isAdmin={isAdmin} onNavigate={onNavigate} />
      </div>
    </section>
  );
}

function LandingGuarantees() {
  return (
    <section className="site-guarantees" aria-label="Гарантии платформы">
      <div className="site-guarantee-pill">
        <span className="dot" /> Zero-Surveillance: данные не видны работодателям
      </div>
      <div className="site-guarantee-pill">
        <span className="dot" /> Anti-Ban: полная безопасность аккаунтов на hh.ru и LinkedIn
      </div>
      <div className="site-guarantee-pill">
        <span className="dot" /> Explainable AI: каждое заключение обосновано фактами
      </div>
    </section>
  );
}

function LandingPillars() {
  return (
    <section id="features" className="site-section" aria-labelledby="pillars-heading">
      <header className="site-section-header">
        <span className="site-section-eyebrow">Архитектура платформы</span>
        <h2 id="pillars-heading" className="site-section-title">Четыре столпа надежной карьеры</h2>
        <p className="site-section-lead">Инструменты, которые возвращают кандидату контроль над карьерным треком.</p>
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
        <span className="site-section-eyebrow">Комплекс решений</span>
        <h2 id="services-heading" className="site-section-title">Полная экосистема карьерных сервисов</h2>
        <p className="site-section-lead">Всё необходимое для аудита, поиска, адаптации материалов и управления развитием.</p>
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
        <span className="site-section-eyebrow">Методология</span>
        <h2 id="how-heading" className="site-section-title">Как работает OpenQareer</h2>
        <p className="site-section-lead">Прозрачный путь от хаотичных записей к управляемой карьерной стратегии.</p>
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
        <p className="site-tariff-price">0 ₽ <span>/ навсегда</span></p>
        <p className="site-tariff-desc">Базовые инструменты для структурирования опыта, аудита и поиска.</p>
      </div>
      <ul className="site-tariff-features">
        <li><CheckCircle size={18} weight="fill" /> Карьерная диагностика и аудит профиля</li>
        <li><CheckCircle size={18} weight="fill" /> Доказательный профиль кандидата</li>
        <li><CheckCircle size={18} weight="fill" /> 1 поисковая подписка на вакансии</li>
        <li><CheckCircle size={18} weight="fill" /> Базовая проверка соответствия резюме</li>
        <li><CheckCircle size={18} weight="fill" /> Локальное и защищённое хранилище данных</li>
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
      <div className="site-tariff-badge">Рекомендуемый</div>
      <div className="site-tariff-header">
        <h3>Сопровождение</h3>
        <p className="site-tariff-price">4 900 ₽ <span>/ месяц</span></p>
        <p className="site-tariff-desc">Полный стек аналитики, агрегатор вакансий, Resume Studio и трек развития.</p>
      </div>
      <ul className="site-tariff-features">
        <li><CheckCircle size={18} weight="fill" /> Всё из базового тарифа</li>
        <li><CheckCircle size={18} weight="fill" /> Безлимитный радар вакансий из 10+ источников</li>
        <li><CheckCircle size={18} weight="fill" /> Полная ATS-диагностика под РФ и International</li>
        <li><CheckCircle size={18} weight="fill" /> Resume Studio и адаптивные сопроводительные письма</li>
        <li><CheckCircle size={18} weight="fill" /> Приоритетный расчёт соответствия и анализ пробелов</li>
        <li><CheckCircle size={18} weight="fill" /> Персональные рекомендации по прохождению интервью</li>
      </ul>
      <button className="site-btn is-primary is-full" type="button" onClick={onAction}>
        {buttonLabel}
      </button>
    </article>
  );
}

function LandingTariffs({ session, onNavigate }: LandingPageProps) {
  const targetAction = session ? () => onNavigate('/app') : () => onNavigate('/signup');
  const primaryButtonLabel = session ? 'Управлять тарифом в кабинете' : 'Подключить тариф';
  const freeButtonLabel = session ? 'Перейти в кабинет' : 'Начать бесплатно';

  return (
    <section id="tariffs" className="site-section" aria-labelledby="tariffs-heading">
      <header className="site-section-header">
        <span className="site-section-eyebrow">Тарифные планы</span>
        <h2 id="tariffs-heading" className="site-section-title">Тарифы и прозрачные условия</h2>
        <p className="site-section-lead">Начните бесплатно и выбирайте уровень аналитики и сопровождения под ваши цели.</p>
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
        <details className="site-faq-item" open>
          <summary>Чем OpenQareer отличается от обычных сервисов и ботов с AI?</summary>
          <div className="site-faq-answer">
            OpenQareer строит доказательный профиль только на базе ваших реальных
            фактов, цифр и артефактов без галлюцинаций. Мы не генерируем бессмысленный
            спам, не рассылаем автоотклики, способные заблокировать ваш аккаунт на hh.ru или LinkedIn,
            и не передаём ваши данные работодателям без вашего явного согласия.
          </div>
        </details>
        <details className="site-faq-item">
          <summary>Как работает мультиисточниковый радар вакансий?</summary>
          <div className="site-faq-answer">
            Система регулярно опрашивает открытые API, RSS-фиды, Telegram-каналы с вакансиями
            и профильные сообщества, дедуплицирует повторяющиеся предложения и оценивает каждое по
            соответствию вашему доказательному профилю.
          </div>
        </details>
        <details className="site-faq-item">
          <summary>Могу ли я использовать OpenQareer бесплатно?</summary>
          <div className="site-faq-answer">
            Да! Базовый тариф &laquo;Самостоятельный&raquo; бесплатен навсегда. Вы получаете карьерную
            диагностику, создание доказательного профиля и базовый поиск вакансий.
          </div>
        </details>
        <details className="site-faq-item">
          <summary>Где хранятся мои личные данные и резюме?</summary>
          <div className="site-faq-answer">
            Ваши данные шифруются на сервере в вашем личном изолированном контуре. Мы придерживаемся
            строгой политики нулевой слежки (Zero-Surveillance): мы никогда не продаем данные рекрутерам.
          </div>
        </details>
      </div>
    </section>
  );
}

function LandingCta({ session, onNavigate }: LandingPageProps) {
  return (
    <section className="site-cta" aria-labelledby="cta-heading">
      <div className="site-cta-inner">
        <h2 id="cta-heading">Готовы взять карьеру под собственный контроль?</h2>
        <p>
          Пройдите карьерную диагностику за 3 минуты и получите доказательный аудит
          вашего профессионального опыта уже сегодня.
        </p>
        <button
          className="site-btn is-primary is-large"
          type="button"
          onClick={() => (session ? onNavigate('/app') : onNavigate('/signup'))}
        >
          {session ? 'Перейти в кабинет' : 'Начать бесплатно'} <ArrowRight size={18} weight="bold" />
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
          <p>Кандидат-центричная карьерная операционная система.</p>
          <span className="site-copyright">
            &copy; {new Date().getFullYear()} OpenQareer. Все права защищены.
          </span>
        </div>
        <div className="site-footer-links">
          <div className="link-group">
            <strong>Продукт</strong>
            <a href="#features">Возможности</a>
            <a href="#services">Экосистема услуг</a>
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
