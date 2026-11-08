import React from 'react';
import { findGuide, relatedHref } from '../../../shared/guides';
import { BLOG_POSTS } from '../../../shared/blog';
import {
  BLOG_COLLECTION,
  GUIDES_COLLECTION,
  collectionPath,
  type GuideCollection,
} from '../../../shared/guides/collection';
import type {
  Guide,
  GuideAction,
  GuideBlock,
  GuideSection,
  GuideSource,
} from '../../../shared/guides';

/** B616: шаблон опорного материала по макету docs-mockups/guide-template.html. */

const TOOL_LABELS: Readonly<Record<string, { title: string; note: string }>> = {
  '/tools/resume': {
    title: 'Конструктор резюме',
    note: 'Три шаблона и проверка на ATS без регистрации.',
  },
  '/tools/interview-questions': {
    title: 'Вопросы на собеседовании',
    note: 'По профессиям, с разбором сильного ответа.',
  },
  '/tools/salary-calculator': {
    title: 'Калькулятор зарплаты на руки',
    note: 'Сколько останется после налогов.',
  },
  '/salaries': {
    title: 'Зарплаты по профессиям',
    note: 'Вилки из открытых вакансий, с датой и выборкой.',
  },
  '/tools/relocation': {
    title: 'В какую страну переехать',
    note: 'Сравнение стран для вашей профессии.',
  },
  '/vacancies': {
    title: 'Каталог вакансий',
    note: 'Вакансии со всего рынка, с источником и датой.',
  },
};

function Arrow() {
  return (
    <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M221.66,133.66l-72,72a8,8,0,0,1-11.32-11.32L196.69,136H40a8,8,0,0,1,0-16H196.69L138.34,61.66a8,8,0,0,1,11.32-11.32l72,72A8,8,0,0,1,221.66,133.66Z" />
    </svg>
  );
}

function Tick() {
  return (
    <span className="oq-guide-tick">
      <svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
        <path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z" />
      </svg>
    </span>
  );
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return year && month && day ? `${day}.${month}.${year}` : iso;
}

function paragraphs(text: string): string[] {
  return text
    .split(/\n{2,}/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function Refs({ ids, sources }: { ids?: readonly string[]; sources: readonly GuideSource[] }) {
  if (!ids?.length) return null;
  return (
    <>
      {ids.map((id) => {
        const number = sources.findIndex((source) => source.id === id) + 1;
        return number > 0 ? (
          <span className="oq-guide-ref" key={id}>
            <a href={`#src-${number}`} aria-label={`Источник ${number}`}>
              [{number}]
            </a>
          </span>
        ) : null;
      })}
    </>
  );
}

function Block({ block, sources }: { block: GuideBlock; sources: readonly GuideSource[] }) {
  switch (block.kind) {
    case 'paragraph':
      return (
        <p>
          {block.text}
          <Refs ids={block.sourceIds} sources={sources} />
        </p>
      );
    case 'list': {
      const items = block.items.map((item) => <li key={item}>{item}</li>);
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    case 'checklist':
      return <Checklist title={block.title} items={block.items} />;
    case 'example':
      return <Example title={block.title} text={block.text} why={block.why} />;
    case 'compare':
      return <Compare weak={block.weak} strong={block.strong} />;
    case 'links':
      return (
        <ul className="oq-guide-links">
          {block.items.map((item) => (
            <li key={item.href}>
              <a href={item.href}>{item.label}</a>
            </li>
          ))}
        </ul>
      );
  }
}

function Checklist({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <div className="oq-guide-checklist">
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>
            <Tick />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Example({ title, text, why }: { title: string; text: string; why?: string }) {
  return (
    <figure className="oq-guide-example">
      <figcaption>{title}</figcaption>
      <blockquote>
        {paragraphs(text).map((part) => (
          <p key={part}>{part}</p>
        ))}
      </blockquote>
      {why ? (
        <div className="oq-guide-why">
          <b>Почему это работает</b>
          <p>{why}</p>
        </div>
      ) : null}
    </figure>
  );
}

function Compare({ weak, strong }: { weak: string; strong: string }) {
  return (
    <div className="oq-guide-compare">
      <div className="oq-guide-weak">
        <b>Слабо</b>
        {weak}
      </div>
      <div className="oq-guide-strong">
        <b>Сильнее</b>
        {strong}
      </div>
    </div>
  );
}

function actionHref(action: GuideAction): string {
  return action.href === '/signup' ? '/signup?from=guide' : action.href;
}

function ActionCard({ action }: { action: GuideAction }) {
  return (
    <aside className="oq-guide-action" aria-label="Что делает openqareer">
      <div>
        <p className="oq-guide-action-label">
          Что делает openqareer
          {action.signedIn ? (
            <>
              {' '}
              <span className="ps-chip">После входа</span>
            </>
          ) : null}
        </p>
        <p>{action.note}</p>
      </div>
      <a className="ps-btn" href={actionHref(action)}>
        {action.label}
        <Arrow />
      </a>
    </aside>
  );
}

function Section({ section, sources }: { section: GuideSection; sources: readonly GuideSource[] }) {
  const headingId = `h-${section.id}`;
  return (
    <section className="oq-guide-section" id={section.id} aria-labelledby={headingId}>
      {section.kicker ? <p className="oq-guide-kicker">{section.kicker}</p> : null}
      <h2 id={headingId}>{section.title}</h2>
      {section.symptom ? (
        <div className="oq-guide-symptom">
          <b>{section.kicker ? 'Как понять, что дело в этом' : 'Когда это про вас'}</b>
          <p>{section.symptom}</p>
        </div>
      ) : null}
      <div className="oq-guide-blocks">
        {section.blocks.map((block, index) => (
          <Block key={`${block.kind}-${index}`} block={block} sources={sources} />
        ))}
      </div>
      {section.action ? <ActionCard action={section.action} /> : null}
    </section>
  );
}

function Crumbs({ current, collection }: { current?: string; collection: GuideCollection }) {
  return (
    <nav className="oq-guide-crumbs" aria-label="Хлебные крошки">
      <ol>
        <li>
          <a href="/">Главная</a>
        </li>
        <li>
          {current ? (
            <a href={collection.root}>{collection.crumb}</a>
          ) : (
            <span aria-current="page">{collection.crumb}</span>
          )}
        </li>
        {current ? (
          <li>
            <span aria-current="page">{current}</span>
          </li>
        ) : null}
      </ol>
    </nav>
  );
}

/** Материал или статья по адресу: связка /guides ↔ /blog в «Читайте также». */
function findByPath(href: string): { guide: Guide; collection: GuideCollection } | undefined {
  for (const [collection, items] of [
    [GUIDES_COLLECTION, undefined],
    [BLOG_COLLECTION, BLOG_POSTS],
  ] as const) {
    const prefix = `${collection.root}/`;
    if (!href.startsWith(prefix)) continue;
    const slug = href.slice(prefix.length);
    const guide = items ? items.find((row) => row.slug === slug) : findGuide(slug);
    return guide ? { guide, collection } : undefined;
  }
  return undefined;
}

function RelatedCard({ entry }: { entry: string }) {
  const href = relatedHref(entry);
  const found = findByPath(href);
  const guide = found?.guide;
  const tool = TOOL_LABELS[href];
  const title = guide?.h1 ?? tool?.title;
  if (!title) return null;
  return (
    <li>
      <a href={href}>
        <span className="oq-guide-related-kind">
          {found ? found.collection.kind : 'Инструмент'}
        </span>
        <b>{title}</b>
        <small>{guide?.eyebrow ?? tool?.note}</small>
      </a>
    </li>
  );
}

function FinalCta() {
  return (
    <section className="oq-guide-final" aria-labelledby="h-final">
      <div>
        <h2 id="h-final">Начните с резюме, которое отвечает на вакансию</h2>
        <p>Тариф Free бесплатен без срока: профиль, должности и вакансии со всего рынка.</p>
      </div>
      <a className="ps-btn is-primary is-lg" href="/signup?from=guide">
        Найти работу
        <Arrow />
      </a>
    </section>
  );
}

export function GuidePage({
  guide,
  collection = GUIDES_COLLECTION,
}: {
  readonly guide: Guide;
  readonly collection?: GuideCollection;
}) {
  const toc = [
    ...guide.sections.map((section) => ({ id: section.id, title: section.title })),
    ...(guide.faq.length > 0 ? [{ id: 'faq', title: 'Вопросы и ответы' }] : []),
    ...(guide.sources.length > 0 ? [{ id: 'sources', title: 'Источники' }] : []),
  ];
  return (
    <main id="main" tabIndex={-1} className="ps-wrap ps-page oq-guide">
      <Crumbs current={guide.crumb} collection={collection} />
      <GuideHero guide={guide} />
      <div className="oq-guide-layout">
        <Toc rows={toc} />
        <article className="oq-guide-article">
          {guide.sections.map((section) => (
            <Section key={section.id} section={section} sources={guide.sources} />
          ))}
          <Faq rows={guide.faq} />
          <Sources sources={guide.sources} />
        </article>
      </div>
      <Related entries={guide.related} />
      <FinalCta />
    </main>
  );
}

function GuideHero({ guide }: { guide: Guide }) {
  return (
    <header className="oq-guide-hero">
      <p className="oq-guide-eyebrow">{guide.eyebrow}</p>
      <h1>{guide.h1}</h1>
      <p className="oq-guide-lead">{guide.lead}</p>
      <div className="oq-guide-cta">
        <a className="ps-btn is-primary is-lg" href={actionHref(guide.primaryAction)}>
          {guide.primaryAction.label}
          <Arrow />
        </a>
        <span className="oq-guide-cta-note">{guide.primaryAction.note}</span>
      </div>
      <p className="oq-guide-updated">
        Обновлено <time dateTime={guide.updatedAt}>{formatDate(guide.updatedAt)}</time>
      </p>
    </header>
  );
}

function Toc({ rows: toc }: { rows: readonly { id: string; title: string }[] }) {
  return (
    <details className="oq-guide-toc" data-oq-guide-toc="">
      <summary>Содержание</summary>
      <nav aria-label="Содержание материала">
        <ol>
          {toc.map((row) => (
            <li key={row.id}>
              <a href={`#${row.id}`}>{row.title}</a>
            </li>
          ))}
        </ol>
      </nav>
    </details>
  );
}

function Faq({ rows }: { rows: Guide['faq'] }) {
  if (rows.length === 0) return null;
  return (
    <section className="oq-guide-faq" id="faq" aria-labelledby="h-faq">
      <h2 id="h-faq">Вопросы и ответы</h2>
      <div className="oq-guide-faq-list">
        {rows.map((row, index) => (
          <details key={row.question} open={index === 0}>
            <summary>{row.question}</summary>
            <p className="oq-guide-answer">{row.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function Sources({ sources }: { sources: readonly GuideSource[] }) {
  if (sources.length === 0) return null;
  return (
    <section className="oq-guide-sources" id="sources" aria-labelledby="h-sources">
      <h2 id="h-sources">Источники</h2>
      <ol className="oq-guide-source-list">
        {sources.map((source, index) => (
          <li id={`src-${index + 1}`} key={source.id}>
            <a href={source.url} rel="noopener">
              {source.title}
            </a>
            <span className="oq-guide-source-meta">
              {source.publisher} · {formatDate(source.date)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Related({ entries }: { entries: readonly string[] }) {
  if (entries.length === 0) return null;
  return (
    <section className="oq-guide-related" aria-labelledby="h-related">
      <h2 id="h-related">Читайте также</h2>
      <ul className="oq-guide-related-list">
        {entries.map((entry) => (
          <RelatedCard key={entry} entry={entry} />
        ))}
      </ul>
    </section>
  );
}

function HubList({
  items,
  collection,
  label,
}: {
  items: readonly Guide[];
  collection: GuideCollection;
  label: string;
}) {
  return (
    <ul className="oq-guide-related-list" aria-label={label}>
      {items.map((item) => (
        <li key={item.slug}>
          <a href={collectionPath(collection, item.slug)}>
            <span className="oq-guide-related-kind">{item.eyebrow}</span>
            <b>{item.h1}</b>
            <small>{item.description}</small>
          </a>
        </li>
      ))}
    </ul>
  );
}

export interface HubCrossLink {
  readonly title: string;
  readonly items: readonly Guide[];
  readonly collection: GuideCollection;
}

export function GuidesHubPage({
  guides,
  title,
  collection = GUIDES_COLLECTION,
  lead = 'Разборы частых трудностей поиска работы: что проверить, как исправить и чем поможет openqareer.',
  cross,
}: {
  readonly guides: readonly Guide[];
  readonly title: string;
  readonly collection?: GuideCollection;
  readonly lead?: string;
  /** B617: соседняя коллекция, чтобы хабы ссылались друг на друга. */
  readonly cross?: HubCrossLink;
}) {
  return (
    <main id="main" tabIndex={-1} className="ps-wrap ps-page oq-guide">
      <Crumbs collection={collection} />
      <header className="oq-guide-hero">
        <p className="oq-guide-eyebrow">Поиск работы</p>
        <h1>{title}</h1>
        <p className="oq-guide-lead">{lead}</p>
      </header>
      <section className="oq-guide-related" aria-label={collection.crumb}>
        <HubList items={guides} collection={collection} label={collection.crumb} />
      </section>
      {cross && cross.items.length > 0 ? (
        <section className="oq-guide-related" aria-labelledby="h-cross">
          <h2 id="h-cross">{cross.title}</h2>
          <HubList items={cross.items} collection={cross.collection} label={cross.title} />
        </section>
      ) : null}
      <FinalCta />
    </main>
  );
}
