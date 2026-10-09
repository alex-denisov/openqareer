import { useEffect } from 'react';
import { BrandMark } from '../brand/BrandMark';
import { CareerTodaySkeleton } from './CareerTodaySkeleton';

const SHELL_SECTIONS = ['Сегодня', 'Профиль', 'Вакансии', 'Отклики'];

function BootstrapRail() {
  return (
    <aside className="career-rail career-bootstrap-rail" aria-hidden="true">
      <span className="career-brand-mark">
        <BrandMark variant="mark" size={30} />
      </span>
      <div className="career-bootstrap-rail-items">
        {SHELL_SECTIONS.map((label, index) => (
          <span className={index === 0 ? 'is-active' : ''} key={label} />
        ))}
      </div>
      <div className="career-rail-bottom">
        <span className="career-bootstrap-icon" />
        <span className="career-bootstrap-icon is-avatar" />
      </div>
    </aside>
  );
}

function BootstrapTopbar() {
  return (
    <header className="career-topbar career-bootstrap-topbar" aria-hidden="true">
      <BrandMark variant="mark" size={26} />
      <span>
        <i className="career-bootstrap-icon" /> Тарифы
      </span>
      <i />
    </header>
  );
}

function BootstrapExpertPanel() {
  return (
    <aside className="career-expert-panel" data-mobile-expanded="false" aria-hidden="true">
      <header>
        <div className="career-expert-identity">
          <span />
          <div>
            <strong>Консультант</strong>
            <small>Сегодня</small>
          </div>
        </div>
      </header>
      <div className="career-expert-conversation">
        <div className="career-expert-panel-skeleton">
          <span className="career-expert-skeleton-line is-wide" />
          <span className="career-expert-skeleton-line" />
        </div>
      </div>
      <div className="career-expert-composer-skeleton">
        <span />
        <span />
      </div>
    </aside>
  );
}

function BootstrapMobileNavigation() {
  return (
    <nav className="career-mobile-nav career-bootstrap-mobile-nav" aria-hidden="true">
      {SHELL_SECTIONS.map((label, index) => (
        <span className={index === 0 ? 'is-active' : ''} key={label}>
          <i />
          <b>{label}</b>
        </span>
      ))}
      <span>
        <i />
        <b>Ещё</b>
      </span>
    </nav>
  );
}

/** Keeps the approved shell visible while its route chunk and profile load. */
export function CareerShellBootstrap() {
  useEffect(() => {
    document.querySelector('#root > .bootstrap-loading')?.remove();
    document.querySelector('#root [data-bootstrap-shell="true"]')?.remove();
  }, []);

  return (
    <div className="career-shell expert-is-open career-bootstrap-shell" aria-busy="true">
      <a className="career-skip-link" href="#career-main">
        К содержанию
      </a>
      <BootstrapRail />
      <BootstrapTopbar />
      <main className="career-main" id="career-main">
        <section className="career-session-gate">
          <CareerTodaySkeleton statusRole={false} />
        </section>
      </main>
      <BootstrapMobileNavigation />
      <BootstrapExpertPanel />
    </div>
  );
}
