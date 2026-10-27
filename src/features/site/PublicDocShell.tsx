import React from 'react';
import { SiteLink } from './SiteLink';
import { PublicFooter, PublicHeader } from './PublicSiteChrome';
import type { PublicSection } from '../../../shared/publicSiteChrome';

export interface DocPageProps {
  readonly onNavigate: (path: string) => void;
  readonly signedIn?: boolean;
  readonly isAdmin?: boolean;
}

/** Page frame of the mockup-built public documents (/faq, /tariffs). */
export function PublicDocShell({
  onNavigate,
  signedIn = false,
  isAdmin = false,
  title,
  structuredData,
  current,
  children,
}: DocPageProps & {
  readonly current: PublicSection;
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</gu, '\\u003c'),
        }}
      />
      <PublicHeader
        onNavigate={onNavigate}
        onLanding={false}
        signedIn={signedIn}
        isAdmin={isAdmin}
        current={current}
      />
      <main id="main" className="pg">
        {children}
      </main>
      <PublicFooter onNavigate={onNavigate} onLanding={false} signedIn={signedIn} />
    </div>
  );
}

export function DocCrumbs({
  current,
  onNavigate,
}: {
  readonly current: string;
  readonly onNavigate: (path: string) => void;
}) {
  return (
    <nav className="ps-wrap pg-crumbs" aria-label="Хлебные крошки">
      <SiteLink to="/" onNavigate={onNavigate}>
        Главная
      </SiteLink>
      <span aria-hidden="true">/</span>
      <span>{current}</span>
    </nav>
  );
}
