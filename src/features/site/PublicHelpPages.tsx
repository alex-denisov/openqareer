import React from 'react';
import { SiteLink } from './SiteLink';
import { preloadAuthPages } from './authPagesLoader';
import { FaqAnswer, PublicFooter, PublicHeader } from './PublicSiteChrome';
import {
  FAQ_GROUPS,
  OPERATOR_TAX_ID,
  SUPPORT_EMAIL,
  TELEGRAM_BOT_URL,
  TELEGRAM_COMMUNITY_URL,
} from './publicSiteContent';
import { faqStructuredData, supportStructuredData } from './publicSiteStructuredData';

export const FAQ_TITLE = 'Как найти работу: резюме, ATS и отклики | openqareer';
export const FAQ_DESCRIPTION =
  'Как найти работу с openqareer: проверка резюме на ATS, подбор вакансий по резюме, сопроводительные письма, отклики, тарифы и данные.';
export const SUPPORT_TITLE = 'Поддержка openqareer: почта, Telegram-бот и сообщество';
export const SUPPORT_DESCRIPTION =
  'Связаться с поддержкой openqareer: support@openqareer.com, Telegram-бот @openqareer_bot и сообщество пользователей. Ответим на вопросы о резюме, вакансиях и тарифах.';

interface HelpPageProps {
  readonly onNavigate: (path: string) => void;
  readonly signedIn?: boolean;
  readonly isAdmin?: boolean;
}

function HelpShell({
  onNavigate,
  signedIn = false,
  isAdmin = false,
  title,
  structuredData,
  children,
}: HelpPageProps & {
  readonly title: string;
  readonly structuredData: Record<string, unknown>;
  readonly children: React.ReactNode;
}) {
  React.useEffect(() => {
    document.title = title;
  }, [title]);
  return (
    <div className="ps">
      <a className="ps-skip" href="#main">
        К содержимому
      </a>
      {Object.keys(structuredData).length > 0 ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(structuredData).replace(/</gu, '\\u003c'),
          }}
        />
      ) : null}
      <PublicHeader
        onNavigate={onNavigate}
        onLanding={false}
        signedIn={signedIn}
        isAdmin={isAdmin}
      />
      <main id="main" className="ps-wrap ps-page">
        {children}
      </main>
      <PublicFooter onNavigate={onNavigate} onLanding={false} signedIn={signedIn} />
    </div>
  );
}

function Crumbs({ current, onNavigate }: { current: string; onNavigate: (p: string) => void }) {
  return (
    <nav className="ps-crumbs" aria-label="Навигационная цепочка">
      <SiteLink to="/" onNavigate={onNavigate}>
        openqareer
      </SiteLink>{' '}
      / <span aria-current="page">{current}</span>
    </nav>
  );
}

function FaqBody() {
  return (
    <>
      <nav className="ps-toc" aria-label="Разделы">
        {FAQ_GROUPS.map((group) => (
          <a key={group.id} href={`#${group.id}`}>
            {group.title}
          </a>
        ))}
      </nav>
      {FAQ_GROUPS.map((group) => (
        <section
          key={group.id}
          className="ps-group"
          id={group.id}
          aria-labelledby={`${group.id}-h`}
        >
          <h2 id={`${group.id}-h`}>{group.title}</h2>
          {group.items.map((item) => (
            <details key={item.id} id={item.id} open={item.id === 'find-job'}>
              <summary>{item.question}</summary>
              <FaqAnswer text={item.answer} links={item.links} />
            </details>
          ))}
          <a className="ps-totop" href="#main">
            Наверх ↑
          </a>
        </section>
      ))}
    </>
  );
}

function FaqCta({ onNavigate }: { onNavigate: (p: string) => void }) {
  return (
    <>
      <div className="ps-cta-box">
        <div>
          <h2>Не нашли ответ?</h2>
          <p>Напишите в поддержку: почта или Telegram.</p>
        </div>
        <div className="ps-cta">
          <SiteLink to="/support" className="ps-btn" onNavigate={onNavigate}>
            Написать в поддержку
          </SiteLink>
          <SiteLink
            to="/signup"
            className="ps-btn is-primary"
            onNavigate={onNavigate}
            onWarm={preloadAuthPages}
          >
            Загрузить резюме бесплатно
          </SiteLink>
        </div>
      </div>
    </>
  );
}

function SupportChannels() {
  return (
    <>
      <div className="ps-channels">
        <div className="ps-channel">
          <h3>Почта</h3>
          <p>
            Для вопросов по оплате, данным и аккаунту. Пишите с адреса, на который зарегистрирован
            аккаунт.
          </p>
          <a className="ps-btn is-primary" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
        </div>
        <div className="ps-channel">
          <h3>Telegram-бот</h3>
          <p>
            Уведомления об откликах и интервью приходят в Telegram. Вопросы поддержки пишите на
            почту.
          </p>
          <a className="ps-btn" href={TELEGRAM_BOT_URL} rel="noopener">
            Открыть @openqareer_bot
          </a>
        </div>
        <div className="ps-channel">
          <h3>Сообщество</h3>
          <p>Группа пользователей openqareer: новости продукта, идеи и обсуждения.</p>
          <a className="ps-btn" href={TELEGRAM_COMMUNITY_URL} rel="noopener">
            Вступить в группу
          </a>
        </div>
      </div>
    </>
  );
}

function SupportExtras({ onNavigate }: { onNavigate: (p: string) => void }) {
  return (
    <>
      <div className="ps-checklist">
        <h2>Чтобы ответ пришёл быстрее</h2>
        <ol>
          <li>Укажите email аккаунта.</li>
          <li>Опишите, что делали и что произошло, по шагам.</li>
          <li>Приложите снимок экрана, если что-то выглядит не так.</li>
          <li>Не присылайте пароли и данные банковских карт: поддержка их не запрашивает.</li>
        </ol>
      </div>
      <div className="ps-checklist">
        <h2>Частые вопросы</h2>
        <ul className="ps-qlinks">
          {QUICK_LINKS.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.text}</a>
            </li>
          ))}
        </ul>
      </div>
      <div className="ps-cta-box">
        <div>
          <h2>Ещё не зарегистрированы?</h2>
          <p>Соберите профиль из резюме и посмотрите подходящие вакансии.</p>
        </div>
        <div className="ps-cta">
          <SiteLink
            to="/signup"
            className="ps-btn is-primary"
            onNavigate={onNavigate}
            onWarm={preloadAuthPages}
          >
            Загрузить резюме бесплатно
          </SiteLink>
        </div>
      </div>
      <div className="ps-req">
        <b>Реквизиты</b>
        <span>ИП, ИНН {OPERATOR_TAX_ID}</span>
        <span>
          Документы: <a href="/legal/terms">соглашение</a>,{' '}
          <a href="/legal/privacy">персональные данные</a>.
        </span>
      </div>
    </>
  );
}

export function FaqPage({ onNavigate, signedIn, isAdmin }: HelpPageProps) {
  return (
    <HelpShell
      onNavigate={onNavigate}
      signedIn={signedIn}
      isAdmin={isAdmin}
      title={FAQ_TITLE}
      structuredData={faqStructuredData()}
    >
      <Crumbs current="Вопросы и ответы" onNavigate={onNavigate} />
      <h1>Вопросы о поиске работы с openqareer</h1>
      <p className="ps-intro">
        Как работает поиск работы с openqareer: резюме и проверка на ATS, подбор вакансий, отклики,
        тарифы и данные.
      </p>
      <FaqBody />
      <FaqCta onNavigate={onNavigate} />
    </HelpShell>
  );
}

const QUICK_LINKS = [
  { href: '/faq', text: 'Все вопросы и ответы' },
  { href: '/faq#cancel', text: 'Как отменить подписку' },
  { href: '/faq#delete-data', text: 'Как выгрузить или удалить данные' },
  { href: '/faq#mac-install', text: 'Как установить приложение на Mac' },
  { href: '/faq#ats', text: 'Как проверить резюме на ATS' },
  { href: '/faq#remote', text: 'Как найти удалённую работу' },
] as const;

export function SupportPage({ onNavigate, signedIn, isAdmin }: HelpPageProps) {
  return (
    <HelpShell
      onNavigate={onNavigate}
      signedIn={signedIn}
      isAdmin={isAdmin}
      title={SUPPORT_TITLE}
      structuredData={supportStructuredData()}
    >
      <Crumbs current="Поддержка" onNavigate={onNavigate} />
      <h1>Поддержка openqareer</h1>
      <p className="ps-intro">
        Вопрос по аккаунту, оплате или работе кабинета: выберите удобный канал. Поддержка отвечает в
        течение рабочего дня. Частые ответы собраны в разделе{' '}
        <SiteLink to="/faq" onNavigate={onNavigate}>
          «Вопросы и ответы»
        </SiteLink>
        .
      </p>
      <h2 className="ps-contact-h">Как связаться с поддержкой</h2>
      <SupportChannels />
      <SupportExtras onNavigate={onNavigate} />
    </HelpShell>
  );
}

export const NOT_FOUND_TITLE = 'Страница не найдена | openqareer';

/** B535: unknown addresses answer 404 with a way back instead of the landing. */
export function NotFoundPage({ onNavigate, signedIn, isAdmin }: HelpPageProps) {
  return (
    <HelpShell
      onNavigate={onNavigate}
      signedIn={signedIn}
      isAdmin={isAdmin}
      title={NOT_FOUND_TITLE}
      structuredData={{}}
    >
      <h1>Такой страницы нет</h1>
      <p className="ps-intro">
        Адрес набран с ошибкой или страницу убрали. Начните с главной, каталога вакансий или ответов
        на частые вопросы.
      </p>
      <p className="ps-cta">
        <SiteLink to="/" className="ps-btn is-primary" onNavigate={onNavigate}>
          На главную
        </SiteLink>
        <a href="/vacancies" className="ps-btn">
          Каталог вакансий
        </a>
        <SiteLink to="/faq" className="ps-btn is-ghost" onNavigate={onNavigate}>
          Вопросы и ответы
        </SiteLink>
      </p>
    </HelpShell>
  );
}
