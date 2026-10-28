import React from 'react';
import { List } from '@phosphor-icons/react';
import { BrandMark } from '../brand/BrandMark';
import {
  BRAND_LABEL,
  FOOTER_ABOUT,
  MENU_ID,
  MENU_LABEL,
  OPERATOR_LINE,
  PLAN_BAR,
  PUBLIC_FOOTER_COLUMNS,
  PUBLIC_NAV,
  SUPPORT_CONTACT,
  type ChromeLink,
  type PublicSection,
} from '../../../shared/publicSiteChrome';
import { SiteLink } from './SiteLink';
import { preloadAuthPages } from './authPagesLoader';
import { PublicToolsMenu } from './PublicToolsMenu';

export interface PublicChromeProps {
  readonly onNavigate: (path: string) => void;
  /** Kept for callers; section links are absolute on every page now. */
  readonly onLanding?: boolean;
  readonly signedIn: boolean;
  /** Administrators also get a link to the console. */
  readonly isAdmin?: boolean;
  /** Nav section that gets `aria-current="page"`. */
  readonly current?: PublicSection;
}

/** Paths the SPA opens without a document load; the rest are plain links. */
const IN_APP =
  /^\/(faq|support|login|signup|tools\/(resume|relocation|country-fit)|legal\/[a-z-]+)?$/u;

function ChromeAnchor({
  link,
  onNavigate,
  current,
}: {
  readonly link: ChromeLink;
  readonly onNavigate: (path: string) => void;
  readonly current?: boolean;
}) {
  const aria = current ? ({ 'aria-current': 'page' } as const) : {};
  if (!link.external && IN_APP.test(link.href)) {
    return (
      <SiteLink to={link.href} onNavigate={onNavigate} {...aria}>
        {link.label}
      </SiteLink>
    );
  }
  return (
    <a href={link.href} rel={link.external ? 'noopener' : undefined} {...aria}>
      {link.label}
    </a>
  );
}

/**
 * B574: both pairs of actions are rendered; `oq-auth-1.js` marks a signed-in
 * visitor on `<html>` before the first paint and CSS shows one pair, so the
 * header never redraws «Войти» into «Открыть кабинет» after the session check.
 */
function HeaderActions({
  onNavigate,
  signedIn,
  isAdmin,
}: Pick<PublicChromeProps, 'onNavigate' | 'signedIn' | 'isAdmin'>) {
  return (
    <>
      {signedIn && isAdmin ? (
        <SiteLink to="/admin" className="ps-btn is-ghost" onNavigate={onNavigate}>
          Администрирование
        </SiteLink>
      ) : null}
      <SiteLink
        to="/login"
        className="ps-btn is-login ps-guest"
        onNavigate={onNavigate}
        onWarm={preloadAuthPages}
      >
        Войти
      </SiteLink>
      <SiteLink
        to="/signup"
        className="ps-btn is-cta ps-guest"
        onNavigate={onNavigate}
        onWarm={preloadAuthPages}
      >
        Найти работу
      </SiteLink>
      <SiteLink to="/app" className="ps-btn is-cta ps-member" onNavigate={onNavigate}>
        Открыть кабинет
      </SiteLink>
    </>
  );
}

/** On phones the header hides «Войти»; the section menu keeps the way in. */
function MenuLogin({ onNavigate }: Pick<PublicChromeProps, 'onNavigate'>) {
  return (
    <SiteLink
      to="/login"
      className="ps-menu-login ps-guest"
      onNavigate={onNavigate}
      onWarm={preloadAuthPages}
    >
      Войти
    </SiteLink>
  );
}

function NavLinks({
  where,
  onNavigate,
  current,
}: Pick<PublicChromeProps, 'onNavigate' | 'current'> & { readonly where: 'nav' | 'menu' }) {
  return (
    <>
      {PUBLIC_NAV.map((item) =>
        item.id === 'tools' ? (
          <PublicToolsMenu key={item.id} where={where} current={current === 'tools'} />
        ) : (
          <ChromeAnchor
            key={item.id}
            link={item}
            onNavigate={onNavigate}
            current={item.id === current}
          />
        ),
      )}
    </>
  );
}

function useMenu() {
  const [open, setOpen] = React.useState(false);
  const button = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('.ps-tools-menu:not([hidden])')) return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  return { open, setOpen, button };
}

/** B569: header shared by every public page (mockup `header()`), with a section menu on phones. */
export function PublicHeader({ onNavigate, signedIn, isAdmin, current }: PublicChromeProps) {
  const { open, setOpen, button } = useMenu();
  return (
    <header className="ps-top">
      <div className="ps-wrap ps-top-row">
        <SiteLink to="/" className="ps-brand" onNavigate={onNavigate} aria-label={BRAND_LABEL}>
          <BrandMark variant="lockup" size={26} />
        </SiteLink>
        <nav className="ps-nav" aria-label="Разделы">
          <NavLinks where="nav" onNavigate={onNavigate} current={current} />
        </nav>
        <div className="ps-top-actions">
          <HeaderActions onNavigate={onNavigate} signedIn={signedIn} isAdmin={isAdmin} />
          <button
            ref={button}
            type="button"
            className="ps-menu-btn"
            aria-label={MENU_LABEL}
            aria-expanded={open}
            aria-controls={MENU_ID}
            data-ps-menu=""
            onClick={() => setOpen((value) => !value)}
          >
            <List size={22} aria-hidden="true" />
          </button>
        </div>
      </div>
      <nav className="ps-menu" id={MENU_ID} aria-label="Разделы" hidden={!open}>
        {/* Drawn when opened: server-rendered pages copy the nav in with
            oq-chrome-2.js, and /salaries keeps to a 20 KB budget. */}
        {open ? <NavLinks where="menu" onNavigate={onNavigate} current={current} /> : null}
        <MenuLogin onNavigate={onNavigate} />
      </nav>
    </header>
  );
}

/** B569: «Free навсегда» strip above the footer on tool, salary and vacancy pages. */
export function PublicPlanBar() {
  return (
    <aside className="ps-plan" aria-label="Тарифы">
      <div className="ps-wrap">
        <span>
          <b>{PLAN_BAR.strong}</b>
          {PLAN_BAR.rest}
        </span>
        <a className="ps-plan-link" href={PLAN_BAR.href}>
          {PLAN_BAR.label}
        </a>
      </div>
    </aside>
  );
}

/** B569: footer from the shared columns (mockup `FOOTER`). */
export function PublicFooter({
  onNavigate,
  planBar = false,
}: PublicChromeProps & { readonly planBar?: boolean }) {
  return (
    <>
      {planBar ? <PublicPlanBar /> : null}
      <footer className="ps-footer">
        <div className="ps-wrap ps-footer-grid">
          <div>
            <SiteLink to="/" className="ps-brand" onNavigate={onNavigate} aria-label={BRAND_LABEL}>
              <BrandMark variant="lockup" size={26} />
            </SiteLink>
            <p className="ps-footer-about">{FOOTER_ABOUT}</p>
          </div>
          {PUBLIC_FOOTER_COLUMNS.map((column) => (
            <div className="ps-footer-group" key={column.title}>
              <b>{column.title}</b>
              {column.links.map((link) => (
                <ChromeAnchor key={link.href} link={link} onNavigate={onNavigate} />
              ))}
            </div>
          ))}
          <div className="ps-footer-legal">
            <span>© {new Date().getFullYear()} openqareer</span>
            <span>{OPERATOR_LINE}</span>
            <span>{SUPPORT_CONTACT}</span>
            {/* Opens the cookie notice from public/assets/oq-analytics-3.js. */}
            <button type="button" className="ps-footer-cookie" data-oq-consent-open="">
              Настройки cookie
            </button>
          </div>
        </div>
      </footer>
    </>
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
