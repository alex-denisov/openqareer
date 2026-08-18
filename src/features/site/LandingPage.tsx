import React from 'react';
import {
  ArrowRight,
  ChartLineUp,
  CheckCircle,
  FileText,
  MagnifyingGlass,
  ShieldCheck,
  Target,
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
      description: 'Candidate-owned career operating system and intelligence.',
    },
    {
      '@type': 'SoftwareApplication',
      name: 'OpenQareer Career OS',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'RUB',
      },
      description:
        'Карьерная операционная система кандидата: доказательный профиль, честная ATS-диагностика, карта рынка и персональные вакансии.',
    },
    {
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Чем OpenQareer отличается от обычных сервисов и ботов с AI?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'OpenQareer строит доказательный профиль только на базе ваших реальных фактов, цифр и артефактов без галлюцинаций, не генерирует бессмысленный спам и не передаёт ваши данные работодателям без вашего явного согласия.',
          },
        },
        {
          '@type': 'Question',
          name: 'Как работает диагностика резюме?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Диагностика проверяет конкретные требования ATS, соответствие структуры целевым ролям и выявляет белые пятна в опыте, выдавая объяснимые шаги по исправлению вместо бесполезных оценок от 1 до 100.',
          },
        },
        {
          '@type': 'Question',
          name: 'Где хранятся мои карьерные данные?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Данные кандидата изолированы, зашифрованы и находятся под полным контролем пользователя. Вы можете экспортировать или безвозвратно удалить свой профиль в любой момент.',
          },
        },
      ],
    },
  ],
};

const FEATURES_DATA = [
  {
    icon: Target,
    title: 'Доказательный профиль',
    desc: 'Факты, метрики и проекты собираются в единое структурированное досье. Каждое утверждение проверено вами и подкреплено реальным опытом.',
  },
  {
    icon: MagnifyingGlass,
    title: 'Честная ATS-диагностика',
    desc: 'Строгий парсинг резюме и сопоставление с реальными фильтрами рекрутеров. Выявляет белые пятна и критические несоответствия до отправки.',
  },
  {
    icon: ChartLineUp,
    title: 'Умная витрина вакансий',
    desc: 'Автоматический сбор и дедупликация вакансий со всех источников. Персональный матчинг с объяснением причин совпадения или пробелов.',
  },
  {
    icon: FileText,
    title: 'Resume Studio',
    desc: 'Адаптация резюме под целевые роли на основе подтверждённых фактов. Без банальных шаблонов и шаблонного текста, отталкивающего нанимателей.',
  },
];

const STEPS_DATA = [
  {
    num: '01',
    title: 'Карьерная диагностика',
    desc: 'Ответьте на ключевые вопросы о текущей ситуации, целях и ожиданиях от следующего шага.',
  },
  {
    num: '02',
    title: 'Импорт и валидация опыта',
    desc: 'Загрузите резюме или подключите профиль — система выделит факты и попросит вас подтвердить их точность.',
  },
  {
    num: '03',
    title: 'Анализ рынка и вакансий',
    desc: 'Получите актуальную выборку вакансий с оценкой соответствия вашему профилю и рекомендациями по устранению пробелов.',
  },
  {
    num: '04',
    title: 'Фокусные отклики',
    desc: 'Создавайте точные доказательные материалы и отслеживайте прогресс каждого отклика в едином кабинете.',
  },
];

function LandingHeader({ session, onNavigate }: LandingPageProps) {
  return (
    <header className="site-header">
      <a
        href="/"
        onClick={(e) => {
          e.preventDefault();
          onNavigate('/');
        }}
        aria-label="Главная OpenQareer"
      >
        <BrandMark variant="lockup" size={28} />
      </a>
      <nav className="site-nav" aria-label="Разделы сайта">
        <a href="#features">Возможности</a>
        <a href="#how-it-works">Как это работает</a>
        <a href="#tariffs">Тарифы</a>
        <a href="#faq">FAQ</a>
      </nav>
      <div className="site-header-actions">
        {session ? (
          <button
            className="site-btn is-primary is-small"
            type="button"
            onClick={() => onNavigate('/app')}
          >
            В кабинет
          </button>
        ) : (
          <>
            <button
              className="site-btn is-ghost is-small"
              type="button"
              onClick={() => onNavigate('/login')}
            >
              Войти
            </button>
            <button
              className="site-btn is-primary is-small"
              type="button"
              onClick={() => onNavigate('/signup')}
            >
              Начать
            </button>
          </>
        )}
      </div>
    </header>
  );
}

function LandingHero({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <section className="site-hero" aria-labelledby="hero-heading">
      <div className="site-badge">
        <ShieldCheck size={16} weight="fill" /> Кандидат-центричная система
      </div>
      <h1 id="hero-heading" className="site-hero-title">
        Карьерная операционная система кандидата
      </h1>
      <p className="site-hero-lead">
        Управляйте карьерой на основе подтверждённых фактов, честной
        ATS-диагностики резюме и прозрачного анализа рынка вакансий. Никаких
        галлюцинаций AI, автооткликов-спама или продажи ваших данных.
      </p>
      <div className="site-hero-actions">
        <button
          className="site-btn is-primary is-large"
          type="button"
          onClick={() => onNavigate('/signup')}
        >
          Пройти карьерную диагностику <ArrowRight size={18} weight="bold" />
        </button>
        <button
          className="site-btn is-secondary is-large"
          type="button"
          onClick={() => onNavigate('/login')}
        >
          Войти в существующий аккаунт
        </button>
      </div>
    </section>
  );
}

function LandingGuarantees() {
  return (
    <section className="site-guarantees" aria-label="Гарантии платформы">
      <div className="site-guarantee-pill">
        <CheckCircle size={18} weight="fill" className="is-positive" />
        <span>100% доказательный профиль без выдумок</span>
      </div>
      <div className="site-guarantee-pill">
        <CheckCircle size={18} weight="fill" className="is-positive" />
        <span>Без спам-рассылок и автобанов на платформах</span>
      </div>
      <div className="site-guarantee-pill">
        <CheckCircle size={18} weight="fill" className="is-positive" />
        <span>Полная конфиденциальность ваших данных</span>
      </div>
    </section>
  );
}

function LandingFeatures() {
  return (
    <section id="features" className="site-section" aria-labelledby="features-heading">
      <header className="site-section-header">
        <p className="site-section-eyebrow">Инструменты</p>
        <h2 id="features-heading" className="site-section-title">Всё для системного поиска и роста</h2>
        <p className="site-section-lead">Один инструмент заменяет разрозненные заметки, таблицы и сомнительные AI-генераторы.</p>
      </header>
      <div className="site-features-grid">
        {FEATURES_DATA.map((item) => {
          const Icon = item.icon;
          return (
            <article key={item.title} className="site-feature-card">
              <div className="site-feature-icon"><Icon size={28} weight="duotone" /></div>
              <h3>{item.title}</h3>
              <p>{item.desc}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function LandingHowItWorks() {
  return (
    <section id="how-it-works" className="site-section" aria-labelledby="hiw-heading">
      <header className="site-section-header">
        <p className="site-section-eyebrow">Процесс</p>
        <h2 id="hiw-heading" className="site-section-title">Как работает OpenQareer</h2>
        <p className="site-section-lead">Четыре понятных шага от диагностики до получения оффера.</p>
      </header>
      <div className="site-steps-list">
        {STEPS_DATA.map((step) => (
          <div key={step.num} className="site-step-card">
            <div className="site-step-num">{step.num}</div>
            <h3>{step.title}</h3>
            <p>{step.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function LandingTariffs({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <section id="tariffs" className="site-section" aria-labelledby="tariffs-heading">
      <header className="site-section-header">
        <p className="site-section-eyebrow">Тарифы</p>
        <h2 id="tariffs-heading" className="site-section-title">Прозрачные условия без скрытых списаний</h2>
        <p className="site-section-lead">Начните бесплатно и выбирайте уровень поддержки под ваши цели.</p>
      </header>
      <div className="site-tariffs-grid">
        <article className="site-tariff-card">
          <div className="site-tariff-header">
            <h3>Самостоятельный</h3>
            <p className="site-tariff-price">0 ₽ <span>/ навсегда</span></p>
            <p className="site-tariff-desc">Базовые инструменты для структурирования опыта и поиска.</p>
          </div>
          <ul className="site-tariff-features">
            <li><CheckCircle size={18} weight="fill" /> Карьерная диагностика</li>
            <li><CheckCircle size={18} weight="fill" /> Доказательный профиль</li>
            <li><CheckCircle size={18} weight="fill" /> 1 подписка на вакансии</li>
            <li><CheckCircle size={18} weight="fill" /> Локальное хранение данных</li>
          </ul>
          <button className="site-btn is-secondary is-full" type="button" onClick={() => onNavigate('/signup')}>
            Начать бесплатно
          </button>
        </article>

        <article className="site-tariff-card is-featured">
          <div className="site-tariff-badge">Рекомендуемый</div>
          <div className="site-tariff-header">
            <h3>Сопровождение</h3>
            <p className="site-tariff-price">4 900 ₽ <span>/ месяц</span></p>
            <p className="site-tariff-desc">Полный стек аналитики, агрегатор вакансий и Resume Studio.</p>
          </div>
          <ul className="site-tariff-features">
            <li><CheckCircle size={18} weight="fill" /> Всё из базового тарифа</li>
            <li><CheckCircle size={18} weight="fill" /> Безлимитный сбор вакансий из 10+ источников</li>
            <li><CheckCircle size={18} weight="fill" /> Полная ATS-диагностика и Resume Studio</li>
            <li><CheckCircle size={18} weight="fill" /> Приоритетный расчёт соответствия</li>
          </ul>
          <button className="site-btn is-primary is-full" type="button" onClick={() => onNavigate('/signup')}>
            Подключить тариф
          </button>
        </article>
      </div>
    </section>
  );
}

function LandingFaq() {
  return (
    <section id="faq" className="site-section" aria-labelledby="faq-heading">
      <header className="site-section-header">
        <p className="site-section-eyebrow">Вопросы и ответы</p>
        <h2 id="faq-heading" className="site-section-title">Часто задаваемые вопросы</h2>
      </header>
      <div className="site-faq-list">
        <details className="site-faq-item" open>
          <summary>Чем OpenQareer отличается от обычных сервисов и ботов с AI?</summary>
          <div className="site-faq-answer">
            OpenQareer строит доказательный профиль только на базе ваших реальных
            фактов, цифр и артефактов без галлюцинаций, не генерирует бессмысленный
            спам и не передаёт ваши данные работодателям без вашего явного согласия.
          </div>
        </details>
        <details className="site-faq-item">
          <summary>Как работает диагностика резюме?</summary>
          <div className="site-faq-answer">
            Диагностика проверяет конкретные требования ATS, соответствие структуры
            целевым ролям и выявляет белые пятна в опыте, выдавая объяснимые шаги по
            исправлению вместо бесполезных оценок от 1 до 100.
          </div>
        </details>
        <details className="site-faq-item">
          <summary>Где хранятся мои карьерные данные?</summary>
          <div className="site-faq-answer">
            Данные кандидата изолированы, зашифрованы и находятся под полным контролем
            пользователя. Вы можете экспортировать или безвозвратно удалить свой профиль
            в любой момент.
          </div>
        </details>
      </div>
    </section>
  );
}

function LandingCta({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <section className="site-cta-banner">
      <h2>Готовы к системному поиску работы?</h2>
      <p>Пройдите бесплатную диагностику и соберите свой доказательный профиль за 5 минут.</p>
      <button
        className="site-btn is-primary is-large"
        type="button"
        onClick={() => onNavigate('/signup')}
      >
        Начать бесплатно <ArrowRight size={18} weight="bold" />
      </button>
    </section>
  );
}

function LandingFooter({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <BrandMark variant="lockup" size={24} />
          <p>© {new Date().getFullYear()} OpenQareer. Все права защищены.</p>
        </div>
        <div className="site-footer-links">
          <a href="#features">Возможности</a>
          <a href="#tariffs">Тарифы</a>
          <a href="#faq">FAQ</a>
          <button type="button" onClick={() => onNavigate('/login')}>Вход</button>
          <button type="button" onClick={() => onNavigate('/signup')}>Регистрация</button>
        </div>
      </div>
    </footer>
  );
}

export function LandingPage({ session, onNavigate }: LandingPageProps) {
  return (
    <div className="site-layout">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
      />
      <LandingHeader session={session} onNavigate={onNavigate} />
      <main id="main-content" className="site-main">
        <LandingHero onNavigate={onNavigate} />
        <LandingGuarantees />
        <LandingFeatures />
        <LandingHowItWorks />
        <LandingTariffs onNavigate={onNavigate} />
        <LandingFaq />
        <LandingCta onNavigate={onNavigate} />
      </main>
      <LandingFooter onNavigate={onNavigate} />
    </div>
  );
}
