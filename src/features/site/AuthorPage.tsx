import React from 'react';
import { AUTHOR, AUTHOR_PATH, AUTHOR_PHOTO_PATH, type AuthorRole } from '../../../shared/author';

/** Подпись материала: фото из профиля автора, имя и ссылка на страницу автора. */
export function AuthorByline() {
  return (
    <p className="oq-guide-byline">
      <img src={AUTHOR_PHOTO_PATH} alt="" width={32} height={32} loading="lazy" />
      <span>
        Автор:{' '}
        <a href={AUTHOR_PATH} rel="author">
          {AUTHOR.nameRu}
        </a>
        , {AUTHOR.jobTitleRu}
      </span>
    </p>
  );
}

function years(from?: string, to?: string): string {
  if (!from) return 'сейчас';
  return to ? `${from}–${to}` : `с ${from}`;
}

export interface AuthorArticle {
  readonly href: string;
  readonly title: string;
}

/** GEO 09.11: страница автора; факты — из профиля на платформе. */
export function AuthorPage({ articles }: { readonly articles: readonly AuthorArticle[] }) {
  return (
    <main id="main" tabIndex={-1} className="ps-wrap ps-page oq-guide">
      <nav className="oq-guide-crumbs" aria-label="Хлебные крошки">
        <ol>
          <li>
            <a href="/">Главная</a>
          </li>
          <li>
            <span aria-current="page">Автор</span>
          </li>
        </ol>
      </nav>
      <header className="oq-guide-hero oq-author-hero">
        <img
          className="oq-author-photo"
          src={AUTHOR_PHOTO_PATH}
          alt={AUTHOR.nameRu}
          width={128}
          height={128}
        />
        <div>
          <p className="oq-guide-eyebrow">{AUTHOR.jobTitleRu}</p>
          <h1>{AUTHOR.nameRu}</h1>
          <p className="oq-guide-lead">{AUTHOR.lead}</p>
          <p className="oq-guide-updated">
            {AUTHOR.nameEn} · {AUTHOR.location} ·{' '}
            <a href={AUTHOR.linkedin} rel="me noopener">
              LinkedIn
            </a>
          </p>
        </div>
      </header>
      <AuthorBody articles={articles} />
    </main>
  );
}

function AuthorBody({ articles }: { readonly articles: readonly AuthorArticle[] }) {
  return (
    <article className="oq-guide-article oq-author-body">
      <section className="oq-guide-section" aria-labelledby="h-career">
        <h2 id="h-career">Опыт</h2>
        <ul className="oq-author-roles">
          {(AUTHOR.roles as readonly AuthorRole[]).map((role) => (
            <li key={`${role.title}-${role.employer}`}>
              <b>{role.title}</b>
              <span>
                {role.employer} · {years(role.from, role.to)}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="oq-guide-section" aria-labelledby="h-education">
        <h2 id="h-education">Образование и языки</h2>
        <ul>
          {[...AUTHOR.education, ...AUTHOR.languages.map((row) => `Язык: ${row}`)].map((row) => (
            <li key={row}>{row}</li>
          ))}
        </ul>
      </section>
      <section className="oq-guide-section" aria-labelledby="h-articles">
        <h2 id="h-articles">Материалы автора</h2>
        <ul>
          {articles.map((article) => (
            <li key={article.href}>
              <a href={article.href}>{article.title}</a>
            </li>
          ))}
        </ul>
      </section>
      <p className="oq-guide-updated">
        Источник фактов: профиль автора на openqareer (импорт LinkedIn), сверено{' '}
        <time dateTime={AUTHOR.checkedAt}>09.11.2026</time>.
      </p>
    </article>
  );
}
