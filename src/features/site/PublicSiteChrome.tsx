import React from 'react';
import { BrandMark } from '../brand/BrandMark';
import { LEGAL_DOCS, legalPath } from '../../../shared/legalRegistry';
import { SiteLink } from './SiteLink';
import { preloadAuthPages } from './authPagesLoader';
import {
  OPERATOR_TAX_ID,
  SUPPORT_EMAIL,
  TELEGRAM_BOT_URL,
  TELEGRAM_COMMUNITY_URL,
} from './publicSiteContent';

export interface PublicChromeProps {
  readonly onNavigate: (path: string) => void;
  /** Section anchors are relative on the landing and absolute elsewhere. */
  readonly onLanding: boolean;
  readonly signedIn: boolean;
  /** Administrators also get a link to the console. */
  readonly isAdmin?: boolean;
  /** B568: off on /salaries, whose raw HTML budget has no room for another footer link. */
  readonly interviewLink?: boolean;
}

function anchor(onLanding: boolean, id: string): string {
  return onLanding ? `#${id}` : `/#${id}`;
}

function HeaderActions({
  onNavigate,
  signedIn,
  isAdmin,
}: Pick<PublicChromeProps, 'onNavigate' | 'signedIn' | 'isAdmin'>) {
  return (
    <div className="ps-top-actions">
      {signedIn ? (
        <>
          {isAdmin ? (
            <SiteLink to="/admin" className="ps-btn is-ghost" onNavigate={onNavigate}>
              Администрирование
            </SiteLink>
          ) : null}
          <SiteLink to="/app" className="ps-btn is-primary" onNavigate={onNavigate}>
            Открыть кабинет
          </SiteLink>
        </>
      ) : (
        <>
          <SiteLink
            to="/login"
            className="ps-btn is-login"
            onNavigate={onNavigate}
            onWarm={preloadAuthPages}
          >
            Войти
          </SiteLink>
          <SiteLink
            to="/signup"
            className="ps-btn is-primary"
            onNavigate={onNavigate}
            onWarm={preloadAuthPages}
          >
            Найти работу
          </SiteLink>
        </>
      )}
    </div>
  );
}

/** B535: header shared by the landing, /faq and /support. */
export function PublicHeader({ onNavigate, onLanding, signedIn, isAdmin }: PublicChromeProps) {
  return (
    <header className="ps-top">
      <div className="ps-wrap ps-top-row">
        <SiteLink to="/" className="ps-brand" onNavigate={onNavigate} aria-label="openqareer">
          <BrandMark variant="lockup" size={26} />
        </SiteLink>
        <nav className="ps-nav" aria-label="Разделы сайта">
          <a href={anchor(onLanding, 'how')}>Как это работает</a>
          <a href={anchor(onLanding, 'apply')}>Кабинет</a>
          <a href={anchor(onLanding, 'tools')}>Вакансии</a>
          <a href={anchor(onLanding, 'tariffs')}>Тарифы</a>
          <SiteLink to="/faq" onNavigate={onNavigate}>
            Вопросы
          </SiteLink>
        </nav>
        <HeaderActions onNavigate={onNavigate} signedIn={signedIn} isAdmin={isAdmin} />
      </div>
    </header>
  );
}

function FooterHelpAndDocs({
  onNavigate,
  interviewLink = true,
}: Pick<PublicChromeProps, 'onNavigate' | 'interviewLink'>) {
  return (
    <>
      <div className="ps-footer-group">
        <b>Помощь</b>
        <SiteLink to="/tools/country-fit" onNavigate={onNavigate}>
          Калькулятор Country Fit
        </SiteLink>
        {interviewLink ? <a href="/tools/interview-questions">Вопросы на собеседовании</a> : null}
        <SiteLink to="/faq" onNavigate={onNavigate}>
          Вопросы и ответы
        </SiteLink>
        <SiteLink to="/support" onNavigate={onNavigate}>
          Поддержка
        </SiteLink>
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        <a href={TELEGRAM_BOT_URL} rel="noopener">
          Telegram-бот
        </a>
        <a href={TELEGRAM_COMMUNITY_URL} rel="noopener">
          Сообщество в Telegram
        </a>
      </div>
      <div className="ps-footer-group">
        <b>Документы</b>
        {LEGAL_DOCS.map((doc) => (
          <SiteLink key={doc.slug} to={legalPath(doc.slug)} onNavigate={onNavigate}>
            {doc.navLabel}
          </SiteLink>
        ))}
      </div>
    </>
  );
}

/** B535: footer with grouped links, contacts and the operator's tax id. */
export function PublicFooter({ onNavigate, onLanding, interviewLink }: PublicChromeProps) {
  return (
    <footer className="ps-footer">
      <div className="ps-wrap ps-footer-grid">
        <div>
          <SiteLink to="/" className="ps-brand" onNavigate={onNavigate} aria-label="openqareer">
            <BrandMark variant="lockup" size={26} />
          </SiteLink>
          <p className="ps-footer-about">Сервис для поиска работы специалистам и руководителям.</p>
        </div>
        <div className="ps-footer-group">
          <b>Продукт</b>
          <a href={anchor(onLanding, 'how')}>Как это работает</a>
          <a href={anchor(onLanding, 'tariffs')}>Тарифы</a>
          <a href={anchor(onLanding, 'download')}>Приложение для компьютера</a>
          <SiteLink to="/login" onNavigate={onNavigate} onWarm={preloadAuthPages}>
            Войти
          </SiteLink>
        </div>
        <div className="ps-footer-group">
          <b>Инструменты</b>
          <a href="/vacancies">Каталог вакансий</a>
          <a href="/vacancies/remote">Удалённые вакансии</a>
          <a href="/salaries">Зарплаты и навыки</a>
        </div>
        <FooterHelpAndDocs onNavigate={onNavigate} interviewLink={interviewLink} />
        <div className="ps-footer-legal">
          <span>© {new Date().getFullYear()} openqareer</span>
          <span>ИП, ИНН {OPERATOR_TAX_ID}</span>
          {/* Opens the cookie notice from public/assets/oq-analytics-3.js. */}
          <button type="button" className="ps-footer-cookie" data-oq-consent-open="">
            Настройки cookie
          </button>
        </div>
      </div>
    </footer>
  );
}

/** FAQ answer text with named fragments turned into links. */
export function FaqAnswer({
  text,
  links,
}: {
  readonly text: string;
  readonly links?: readonly { readonly text: string; readonly href: string }[];
}) {
  if (!links || links.length === 0) return <p>{text}</p>;
  const parts: React.ReactNode[] = [];
  let rest = text;
  links.forEach((link, index) => {
    const at = rest.indexOf(link.text);
    if (at < 0) return;
    parts.push(rest.slice(0, at));
    parts.push(
      <a key={index} href={link.href}>
        {link.text}
      </a>,
    );
    rest = rest.slice(at + link.text.length);
  });
  parts.push(rest);
  return <p>{parts}</p>;
}
