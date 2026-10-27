import React from 'react';
import { ArrowRight, MagnifyingGlass } from '@phosphor-icons/react';
import { DocCrumbs, PublicDocShell, type DocPageProps } from './PublicDocShell';
import { SiteLink } from './SiteLink';
import { FAQ_TOPICS, type FaqEntry, type FaqTopic } from './faqPageContent';
import { faqStructuredData } from './publicSiteStructuredData';

export const FAQ_TITLE = 'Вопросы о поиске работы: резюме, отклик, оффер | openqareer';
export const FAQ_DESCRIPTION =
  'Ответы на 48 вопросов о поиске работы: кем я могу работать, почему не берут, что писать в отклике, что такое оффер и ATS, как найти работу без опыта и за границей.';
const SIGNUP = '/signup?from=faq';
const PHONE_QUERY = '(max-width: 760px)';

function ArrowLink({ href, className, children }: Readonly<{ href: string; className: string; children: React.ReactNode }>) {
  return (
    <a className={className} href={href}>
      {children}
      <ArrowRight size={16} className="pg-icon" aria-hidden="true" />
    </a>
  );
}

function Entry({
  entry,
  open,
  onToggle,
  hidden,
  isFirst,
}: Readonly<{
  entry: FaqEntry;
  open: boolean;
  onToggle: () => void;
  hidden: boolean;
  isFirst: boolean;
}>) {
  return (
    <article
      className={`pg-qa${open ? ' is-open' : ''}${isFirst ? ' is-first' : ''}`}
      id={entry.id}
      hidden={hidden}
    >
      <h3>
        <button type="button" className="pg-qbtn" aria-expanded={open} onClick={onToggle}>
          {entry.question}
        </button>
      </h3>
      <p>{entry.answer}</p>
      {entry.go ? (
        <ArrowLink className="pg-link pg-go" href={entry.go.href}>
          {entry.go.text}
        </ArrowLink>
      ) : null}
    </article>
  );
}

function Topic({
  topic,
  isOpen,
  toggle,
  query,
}: Readonly<{
  topic: FaqTopic;
  isOpen: (id: string, first: boolean) => boolean;
  toggle: (id: string, first: boolean) => void;
  query: string;
}>) {
  return (
    <section className="pg-topic" id={topic.id} aria-labelledby={`h-${topic.id}`}>
      <header>
        <h2 id={`h-${topic.id}`}>{topic.title}</h2>
        {topic.link ? (
          <ArrowLink className="pg-link" href={topic.link.href}>
            {topic.link.text}
          </ArrowLink>
        ) : null}
      </header>
      {topic.items.map((entry, index) => (
        <Entry
          key={entry.id}
          entry={entry}
          isFirst={index === 0}
          open={isOpen(entry.id, index === 0)}
          onToggle={() => toggle(entry.id, index === 0)}
          hidden={query !== '' && !`${entry.question} ${entry.answer}`.toLowerCase().includes(query)}
        />
      ))}
    </section>
  );
}

/** First answer of a topic is open on desktop; a phone starts folded. */
function useOpenState() {
  const [desktop, setDesktop] = React.useState(true);
  const [chosen, setChosen] = React.useState<Readonly<Record<string, boolean>>>({});
  React.useEffect(() => {
    setDesktop(!window.matchMedia(PHONE_QUERY).matches);
    const id = window.location.hash.slice(1);
    if (id) setChosen((state) => ({ ...state, [id]: true }));
  }, []);
  const isOpen = (id: string, first: boolean) => chosen[id] ?? (first && desktop);
  const toggle = (id: string, first: boolean) =>
    setChosen((state) => ({ ...state, [id]: !(state[id] ?? (first && desktop)) }));
  return { isOpen, toggle };
}

/** The topic the reader is in, for the contents list. */
function useCurrentTopic(): string {
  const [current, setCurrent] = React.useState(FAQ_TOPICS[0]?.id ?? '');
  React.useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setCurrent(entry.target.id);
        });
      },
      { rootMargin: '-30% 0px -60% 0px' },
    );
    document.querySelectorAll('.pg-topic').forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);
  return current;
}

function Contents({ current }: Readonly<{ current: string }>) {
  return (
    <nav className="pg-toc" aria-label="Темы">
      {FAQ_TOPICS.map((topic) => (
        <a key={topic.id} href={`#${topic.id}`} aria-current={topic.id === current}>
          {topic.title} <span>{topic.items.length}</span>
        </a>
      ))}
      <div className="pg-toc-side">
        <b>Не нашли свой вопрос?</b>
        <p>
          Загрузите резюме — openqareer покажет, что мешает именно вам: резюме, отклик или ожидания
          по зарплате.
        </p>
        <a className="pg-btn is-primary" href={SIGNUP}>
          Найти работу
        </a>
      </div>
    </nav>
  );
}

export function FaqPage({ onNavigate, signedIn, isAdmin }: DocPageProps) {
  const [query, setQuery] = React.useState('');
  const { isOpen, toggle } = useOpenState();
  const current = useCurrentTopic();
  const needle = query.trim().toLowerCase();
  return (
    <PublicDocShell
      onNavigate={onNavigate}
      signedIn={signedIn}
      isAdmin={isAdmin}
      title={FAQ_TITLE}
      current="faq"
      structuredData={faqStructuredData()}
    >
      <DocCrumbs current="Вопросы и ответы" onNavigate={onNavigate} />
      <section className="pg-hero">
        <div className="ps-wrap">
          <span className="pg-eyebrow">Ответы на 48 главных вопросов о поиске работы</span>
          <h1>Вопросы о поиске работы: короткие ответы</h1>
          <p className="pg-lead">
            Кем работать с вашим опытом, почему нет ответа на отклики, что говорить на собеседовании
            и как не продешевить с оффером.
          </p>
          <form className="pg-search" role="search" onSubmit={(event) => event.preventDefault()}>
            <MagnifyingGlass size={18} aria-hidden="true" />
            <label className="pg-sr" htmlFor="fq-s">
              Найти вопрос
            </label>
            <input
              id="fq-s"
              placeholder="Например: что писать в отклике"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </form>
        </div>
      </section>
      <div className="ps-wrap pg-fq">
        <Contents current={current} />
        <div>
          {FAQ_TOPICS.map((topic) => (
            <Topic key={topic.id} topic={topic} isOpen={isOpen} toggle={toggle} query={needle} />
          ))}
          <div className="pg-strip pg-cta-mid">
            <div>
              <h3>Узнайте, что мешает именно вам</h3>
              <p>Загрузите резюме: покажем должности, на которые вы проходите, и вакансии под них.</p>
            </div>
            <SiteLink to={SIGNUP} className="pg-btn is-primary is-lg" onNavigate={onNavigate}>
              Найти работу
            </SiteLink>
          </div>
        </div>
      </div>
    </PublicDocShell>
  );
}
