import React from 'react';
import { BrandMark } from '../brand/BrandMark';
import { SiteLink } from '../site/SiteLink';
import { LEGAL_CONTENT, type LegalBlock, type LegalSection } from './legalContent';
import { legalStructuredData } from './legalStructuredData';
import { SITE_ORIGIN } from '../../../shared/aeoSurface';
import {
  LEGAL_DOCS,
  LEGAL_PACK_PUBLISHED_AT,
  LEGAL_PACK_VERSION,
  legalDocMeta,
  legalPath,
  type LegalDocSlug,
} from '../../../shared/legalRegistry';


export function legalDocumentTitle(slug: LegalDocSlug): string {
  return `${legalDocMeta(slug).title} · OpenQareer`;
}

/** A published legal document: indexable, canonical and dated (B173). */
export function LegalDocumentPage({
  slug,
  onNavigate,
}: {
  slug: LegalDocSlug;
  onNavigate: (path: string) => void;
}) {
  const meta = legalDocMeta(slug);
  const sections = LEGAL_CONTENT[slug];

  React.useEffect(() => {
    document.title = legalDocumentTitle(slug);
    setMetaTag('description', meta.description);
    setCanonical(`${SITE_ORIGIN}${legalPath(slug)}`);
  }, [meta.description, slug]);

  return (
    <div className="site-layout legal-layout">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(legalStructuredData(slug)) }}
      />
      <LegalPageHeader onNavigate={onNavigate} />
      <main id="main-content" className="legal-main">
        <article className="legal-document">
          <h1>{meta.title}</h1>
          <p className="legal-meta">
            Редакция {LEGAL_PACK_VERSION} · опубликована {formatPublishedAt(LEGAL_PACK_PUBLISHED_AT)}
          </p>
          {sections.map((section) => (
            <LegalSectionView key={section.heading} section={section} />
          ))}
        </article>
        <LegalPageNav slug={slug} onNavigate={onNavigate} />
      </main>
      <LegalPageFooter onNavigate={onNavigate} />
    </div>
  );
}

function LegalPageHeader({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <header className="legal-header">
      <SiteLink to="/" className="legal-brand" onNavigate={onNavigate}>
        <BrandMark variant="lockup" size={24} />
      </SiteLink>
    </header>
  );
}

function LegalPageNav({
  slug,
  onNavigate,
}: {
  slug: LegalDocSlug;
  onNavigate: (path: string) => void;
}) {
  return (
    <nav className="legal-nav" aria-label="Юридические документы">
      <strong>Все документы</strong>
      <ul>
        {LEGAL_DOCS.map((doc) => (
          <li key={doc.slug}>
            {doc.slug === slug ? (
              <span aria-current="page">{doc.title}</span>
            ) : (
              <SiteLink to={legalPath(doc.slug)} onNavigate={onNavigate}>
                {doc.title}
              </SiteLink>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

function LegalPageFooter({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <footer className="legal-footer">
      <SiteLink to="/" onNavigate={onNavigate}>
        На главную
      </SiteLink>
      <span>&copy; {new Date().getFullYear()} OpenQareer</span>
    </footer>
  );
}

function LegalSectionView({ section }: { section: LegalSection }) {
  return (
    <section>
      <h2>{section.heading}</h2>
      {section.blocks.map((block, index) => (
        <LegalBlockView key={index} block={block} />
      ))}
    </section>
  );
}

function LegalBlockView({ block }: { block: LegalBlock }) {
  if (block.kind === 'paragraph') return <p>{block.text}</p>;
  if (block.kind === 'list') {
    return (
      <ul>
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }
  return (
    <div className="legal-table-scroll">
      <table>
        <thead>
          <tr>
            <th>{block.head[0]}</th>
            <th>{block.head[1]}</th>
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row) => (
            <tr key={row[0]}>
              <td>{row[0]}</td>
              <td>{row[1]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

function formatPublishedAt(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]} ${year} г.`;
}

function setMetaTag(name: string, content: string): void {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.name = name;
    document.head.append(tag);
  }
  tag.content = content;
}

function setCanonical(href: string): void {
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.append(link);
  }
  link.href = href;
}
