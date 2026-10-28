import React from 'react';
import { pluralWordRu } from '../../../shared/pluralRu';
import { ToolCrumbs } from './ToolCrumbs';
import {
  INTERVIEW_EVIDENCE,
  INTERVIEW_HUB_PATH,
  INTERVIEW_OPEN_QUESTIONS,
  interviewEvidence,
  interviewProfessionPath,
  lockedInterviewQuestions,
  openInterviewQuestions,
  type InterviewProfession,
  type InterviewQuestion,
  type InterviewQuestionKind,
} from '../../../shared/interviewQuestions';

export const INTERVIEW_HUB_TITLE = 'Вопросы на собеседовании по профессиям с ответами · openqareer';
export const INTERVIEW_HUB_DESCRIPTION =
  'Вопросы, которые задают на собеседовании, по профессиям — с разбором сильного ответа. Темы сверены с требованиями реальных вакансий. Проверьте себя в коротком тесте без регистрации.';

const VACANCIES: [string, string, string] = ['вакансия', 'вакансии', 'вакансий'];
/** «требования 1 543 вакансий», «из 1 228 вакансий»: genitive after a governing word. */
const VACANCIES_OF: [string, string, string] = ['вакансии', 'вакансий', 'вакансий'];
const QUESTIONS: [string, string, string] = ['вопрос', 'вопроса', 'вопросов'];
const KIND_CHIP: Record<InterviewQuestionKind, string> = {
  professional: 'профессиональный',
  experience: 'про опыт',
  motivation: 'мотивация',
  money: 'деньги',
};

/** One row of the hub: a profession with its live catalog count, when the catalog has it. */
export interface InterviewHubEntry {
  readonly profession: InterviewProfession;
  readonly vacancies: number;
}

function count(value: number, forms: [string, string, string]): string {
  return `${value.toLocaleString('ru-RU')} ${pluralWordRu(value, forms)}`;
}

export function signupHref(role?: string): string {
  return role
    ? `/signup?from=interview&role=${encodeURIComponent(role)}`
    : '/signup?from=interview';
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return year && month && day ? `${day}.${month}.${year}` : iso;
}

export function interviewProfessionTitle(profession: InterviewProfession): string {
  return `Вопросы на собеседовании ${profession.genitive} с ответами · openqareer`;
}

export function interviewProfessionDescription(profession: InterviewProfession): string {
  const evidence = interviewEvidence(profession.slug);
  return `Первые ${INTERVIEW_OPEN_QUESTIONS} из ${profession.questions.length} вопросов, которые задают на собеседовании ${profession.genitive}, с разбором сильного ответа.${
    evidence
      ? ` Темы сверены с требованиями ${count(evidence.described, VACANCIES_OF)} с полным текстом.`
      : ''
  } Проверьте себя в тесте.`;
}

function Crumbs({ profession }: { profession?: InterviewProfession }) {
  return (
    <ToolCrumbs
      wrapped
      trail={
        profession
          ? [
              { label: 'Вопросы на собеседовании', href: INTERVIEW_HUB_PATH },
              { label: profession.label },
            ]
          : [{ label: 'Вопросы на собеседовании' }]
      }
    />
  );
}

function TrainerStrip({ role, title }: { role?: string; title: string }) {
  return (
    <section className="iq-strip" aria-label="Тренажёр собеседования">
      <div>
        <h2>{title}</h2>
        <p>
          Тренажёр задаёт вопросы из требований выбранной вакансии, разбирает ваш ответ и собирает
          истории по методу STAR из вашего опыта. Тренажёр — в Basic и выше.
        </p>
      </div>
      <a className="ps-btn is-primary is-lg" href={signupHref(role)}>
        Отрепетировать ответ
      </a>
    </section>
  );
}

export const INTERVIEW_HUB_FAQ: readonly { question: string; answer: string }[] = [
  {
    question: 'Откуда эти вопросы?',
    answer: `Вопросы составила редакция openqareer по темам, которые чаще всего встречаются в требованиях вакансий каталога за ${INTERVIEW_EVIDENCE.windowDays} дней: что работодатели просят, то и проверяют на собеседовании. У каждого вопроса указано, в скольких вакансиях встречается тема, у страницы — выборка и дата замера.`,
  },
  {
    question: 'Нужна ли регистрация?',
    answer: `Нет: первые ${INTERVIEW_OPEN_QUESTIONS} вопросов с разбором и тест самопроверки открыты. Регистрация нужна для остальных вопросов профессии; тренажёр под конкретную вакансию — в Basic и выше.`,
  },
  {
    question: 'Для каких профессий есть вопросы?',
    answer: `Для профессий, по которым в каталоге достаточно вакансий с полным текстом требований — от ${INTERVIEW_EVIDENCE.minDescribed} описаний. Список растёт по мере вычитки новых профессий.`,
  },
];

function HubHero() {
  return (
    <header className="iq-hero iq-hero-split">
      <div>
        <p className="ps-label">Собеседование · вопросы по профессиям</p>
        <h1>Вопросы на собеседовании с разбором ответов</h1>
        <p className="ps-intro">
          Вопросы на собеседовании по профессиям, сверенные с требованиями реальных вакансий: у
          каждого — что им проверяют и как звучит сильный ответ, в конце — тест на 5 вопросов.
          Выберите профессию — вопросы откроются сразу, без регистрации.
        </p>
      </div>
      <div className="iq-types">
        <div>
          <b>Профессиональные</b>
          <p>Знания и инструменты из требований вакансий</p>
        </div>
        <div>
          <b>Про опыт</b>
          <p>«Расскажите о случае, когда…» — ответ по методу STAR</p>
        </div>
        <div>
          <b>Мотивация</b>
          <p>Почему уходите и почему к нам</p>
        </div>
        <div>
          <b>Деньги</b>
          <p>Ожидания по зарплате с опорой на рынок</p>
        </div>
      </div>
    </header>
  );
}

function lockedMax(entries: readonly InterviewHubEntry[]): number {
  return Math.max(0, ...entries.map((row) => lockedInterviewQuestions(row.profession).length));
}

const ARROW = (
  <svg className="iq-ic" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

function HubProfessions({ entries }: { entries: readonly InterviewHubEntry[] }) {
  return (
    <section className="iq-section" aria-labelledby="iq-pick">
      <h2 id="iq-pick">Выберите свою профессию</h2>
      <p className="ps-soft">
        {`${INTERVIEW_OPEN_QUESTIONS} вопросов с разбором открыты сразу${
          lockedMax(entries) ? `, ещё ${lockedMax(entries)} — после бесплатной регистрации` : ''
        }. `}{' '}
        <a href={signupHref('trainer')}>Отрепетировать ответы под вашу профессию</a> — тренажёр с ИИ
        в Basic.
      </p>
      <div className="iq-tools">
        <label className="iq-visually-hidden" htmlFor="iq-search">
          Найти профессию
        </label>
        <input
          className="iq-input"
          id="iq-search"
          type="search"
          placeholder="Найти профессию, например «бухгалтер»"
          data-iq-search=""
        />
        <span className="ps-soft iq-hide-m">Сколько сейчас вакансий по профессии</span>
      </div>
      <ul className="iq-professions" id="iq-list">
        {entries.map(({ profession, vacancies }) => (
          <li key={profession.slug}>
            <a href={interviewProfessionPath(profession.slug)}>
              <b>{profession.label}</b>
              {vacancies > 0 ? <span>{count(vacancies, VACANCIES)}</span> : null}
            </a>
          </li>
        ))}
      </ul>
      <p className="iq-empty" data-iq-empty="" hidden>
        Такой профессии пока нет. Тренажёр задаст вопросы по требованиям любой вакансии.
      </p>
      <MoreProfessions total={entries.length} />
      <div className="iq-actions">
        <a className="ps-btn is-primary" href={signupHref()}>
          Открыть все вопросы с разбором — бесплатно
        </a>
      </div>
    </section>
  );
}

/** Phones fold the list after FOLD_PHONE professions, wider screens after FOLD_WIDE (mockup 04a). */
const FOLD_PHONE = 5;
const FOLD_WIDE = 12;

function MoreProfessions({ total }: { readonly total: number }) {
  if (total <= FOLD_PHONE) return null;
  return (
    <div className={total > FOLD_WIDE ? 'iq-more' : 'iq-more iq-only-m'}>
      <button
        className="ps-btn"
        type="button"
        aria-controls="iq-list"
        aria-expanded="false"
        data-iq-more=""
      >
        Показать все профессии
      </button>
      <span className="ps-soft iq-hide-m">Частые профессии из разных сфер</span>
    </div>
  );
}

export function InterviewHubPage({ entries }: { entries: readonly InterviewHubEntry[] }) {
  return (
    <main id="main" tabIndex={-1} className="ps-wrap ps-page iq-page">
      <Crumbs />
      <HubHero />
      <HubProfessions entries={entries} />
      <section className="iq-section" aria-labelledby="iq-faq">
        <p className="ps-label">Вопросы</p>
        <h2 id="iq-faq">О вопросах на собеседовании</h2>
        <div className="iq-faq">
          {INTERVIEW_HUB_FAQ.map((row, index) => (
            <details key={row.question} open={index === 0}>
              <summary>{row.question}</summary>
              <p>{row.answer}</p>
            </details>
          ))}
        </div>
      </section>
      <TrainerStrip title="Нет вашей профессии или нужна подготовка под конкретную вакансию?" />
    </main>
  );
}

function QuestionEvidence({
  question,
  profession,
}: {
  question: InterviewQuestion;
  profession: InterviewProfession;
}) {
  const evidence = interviewEvidence(profession.slug);
  const matched = question.topic ? evidence?.topics[question.id] : undefined;
  if (!question.topic || !evidence || !matched) return null;
  return (
    <p className="iq-source">
      Тема «{question.topic.label}» — в {matched.toLocaleString('ru-RU')} из{' '}
      {count(evidence.described, VACANCIES_OF)} с полным текстом
    </p>
  );
}

function OpenQuestion({
  question,
  profession,
  first,
}: {
  question: InterviewQuestion;
  profession: InterviewProfession;
  first: boolean;
}) {
  return (
    <details className="iq-q" open={first} data-kind={question.kind}>
      <summary>
        <b>{question.question}</b>
        <span className="ps-chip">{KIND_CHIP[question.kind]}</span>
      </summary>
      <div className="iq-body">
        <p className="iq-why">
          <b>Что проверяют:</b> {question.checks}
        </p>
        <div className="iq-good">
          <small>Сильный ответ</small>
          {question.strong}
          {question.kind === 'money' ? (
            <>
              {' '}
              <a href={`/salaries/${profession.slug}`}>
                Зарплаты: {profession.label.toLowerCase()}
              </a>
            </>
          ) : null}
        </div>
        {question.weak ? (
          <div className="iq-weak">
            <small>Слабый ответ</small>
            {question.weak}
          </div>
        ) : null}
        <QuestionEvidence question={question} profession={profession} />
        <a className="iq-train" href={signupHref(profession.slug)}>
          Отрепетировать ответ в тренажёре {ARROW}
        </a>
        {first ? (
          <p className="ps-soft iq-train-note">
            ИИ разберёт ваш ответ по тем же критериям, что и работодатель. Тренажёр — в Basic.
          </p>
        ) : null}
      </div>
    </details>
  );
}

function KindFilters({
  questions,
  unlocked,
}: {
  questions: readonly InterviewQuestion[];
  unlocked: boolean;
}) {
  const of = (kinds: InterviewQuestionKind[]) =>
    questions.filter((row) => kinds.includes(row.kind)).length;
  const filters: [string, string, number][] = [
    ['all', unlocked ? 'Все' : 'Все открытые', questions.length],
    ['professional', 'Профессиональные', of(['professional'])],
    ['experience', 'Про опыт', of(['experience'])],
    ['motivation money', 'Мотивация и деньги', of(['motivation', 'money'])],
  ];
  return (
    <div className="iq-filters" role="group" aria-label="Тип вопросов">
      {filters
        .filter(([, , total]) => total > 0)
        .map(([kinds, label, total]) => (
          <button key={kinds} type="button" aria-pressed={kinds === 'all'} data-iq-filter={kinds}>
            {label} {total}
          </button>
        ))}
    </div>
  );
}

function LockedQuestions({ profession }: { profession: InterviewProfession }) {
  const locked = lockedInterviewQuestions(profession);
  if (!locked.length) return null;
  return (
    <>
      <ol
        className="iq-locked"
        start={INTERVIEW_OPEN_QUESTIONS + 1}
        aria-label="Вопросы после регистрации"
      >
        {locked.map((row) => (
          <li key={row.id}>
            <svg className="iq-ic" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            <span>{row.question}</span>
            <span className="ps-soft">после регистрации</span>
          </li>
        ))}
      </ol>
      <div className="iq-gate">
        <p>
          <b>Ещё {count(locked.length, QUESTIONS)} с разбором ответа</b> открываются после
          бесплатной регистрации. Первые {INTERVIEW_OPEN_QUESTIONS} — на этой странице целиком.
        </p>
        <a className="ps-btn is-primary is-lg" href={signupHref(profession.slug)}>
          Открыть ещё {locked.length} бесплатно
        </a>
      </div>
    </>
  );
}

function Quiz({ profession, unlocked }: { profession: InterviewProfession; unlocked: boolean }) {
  const first = profession.quiz[0];
  if (!first) return null;
  const data = JSON.stringify({
    signup: signupHref(profession.slug),
    locked: unlocked ? 0 : lockedInterviewQuestions(profession).length,
    lockedLabel: count(lockedInterviewQuestions(profession).length, QUESTIONS),
    items: profession.quiz,
  }).replace(/</gu, '\\u003c');
  return (
    <aside className="iq-quiz" aria-labelledby="iq-quiz-h" data-iq-quiz="">
      <div className="iq-quiz-head">
        <span id="iq-quiz-h">Проверьте себя · без регистрации</span>
        <span data-iq-step="">1 из {profession.quiz.length}</span>
      </div>
      <div className="iq-bar">
        <i data-iq-bar="" />
      </div>
      <div className="iq-quiz-body" data-iq-box="" aria-live="polite">
        <b>{first.question}</b>
        {first.options.map((option, index) => (
          <button className="iq-opt" type="button" aria-pressed="false" data-k={index} key={option}>
            <span className="iq-mk" />
            <span>{option}</span>
          </button>
        ))}
        <p className="iq-expl" hidden />
      </div>
      <div className="iq-quiz-foot">
        <span className="ps-soft">Ответы проверяются сразу</span>
        <button className="ps-btn" type="button" data-iq-next="" disabled>
          Дальше
        </button>
      </div>
      <script
        type="application/json"
        data-iq-quiz-data=""
        dangerouslySetInnerHTML={{ __html: data }}
      />
    </aside>
  );
}

function ProfessionHero({
  profession,
  vacancies,
  open,
  unlocked,
}: {
  profession: InterviewProfession;
  vacancies: number;
  open: number;
  unlocked: boolean;
}) {
  const locked = lockedInterviewQuestions(profession).length;
  const evidence = interviewEvidence(profession.slug);
  return (
    <header className="iq-hero">
      <p className="ps-label">Собеседование · {profession.label.toLowerCase()}</p>
      <h1>
        Вопросы на собеседовании {profession.genitive}:{' '}
        {unlocked
          ? `${open} разборов`
          : `${open} разборов${locked ? ` и ещё ${locked} после регистрации` : ''}`}
      </h1>
      {evidence ? (
        <p className="ps-intro">
          Темы вопросов — те, что чаще всего встречаются в требованиях{' '}
          {count(evidence.described, VACANCIES_OF)} {profession.genitive} с полным текстом. К
          каждому вопросу — что проверяет работодатель, как звучит сильный ответ и в скольких
          вакансиях встречается тема.
        </p>
      ) : null}
      <div className="iq-meta">
        {vacancies > 0 ? (
          <span className="ps-chip">
            Сейчас в каталоге: {count(vacancies, VACANCIES)} за {INTERVIEW_EVIDENCE.windowDays} дней
          </span>
        ) : null}
        {evidence ? (
          <span className="ps-chip">
            С полным текстом: {evidence.described.toLocaleString('ru-RU')}
          </span>
        ) : null}
        <span className="ps-chip">
          Требования замерены {formatDate(INTERVIEW_EVIDENCE.measuredAt)}
        </span>
      </div>
    </header>
  );
}

function ProfessionLinks({
  profession,
  vacancies,
  related,
}: {
  profession: InterviewProfession;
  vacancies: number;
  related: readonly InterviewHubEntry[];
}) {
  return (
    <>
      <nav className="iq-links" aria-label="По этой профессии">
        {vacancies > 0 ? (
          <a href="/vacancies">
            {count(vacancies, VACANCIES)} {profession.genitive} в каталоге {ARROW}
          </a>
        ) : null}
        <a href={`/salaries/${profession.slug}`}>
          Зарплаты {profession.genitive} по городам {ARROW}
        </a>
        <a href="/tools/resume">
          Резюме {profession.genitive}: результаты, за которые зовут {ARROW}
        </a>
      </nav>
      {related.length ? (
        <section className="iq-related" aria-labelledby="iq-related-h">
          <h2 id="iq-related-h">Вопросы для других профессий</h2>
          <div>
            {related.map((row) => (
              <a key={row.profession.slug} href={interviewProfessionPath(row.profession.slug)}>
                {row.profession.label}
                {row.vacancies > 0 ? <span>{row.vacancies.toLocaleString('ru-RU')}</span> : null}
              </a>
            ))}
            <a href={INTERVIEW_HUB_PATH}>Все профессии</a>
          </div>
        </section>
      ) : null}
    </>
  );
}

export function InterviewProfessionPage({
  profession,
  vacancies,
  related,
  unlocked = false,
}: {
  profession: InterviewProfession;
  vacancies: number;
  related: readonly InterviewHubEntry[];
  /** Signed-in reader: every question is printed in full. */
  unlocked?: boolean;
}) {
  const open = unlocked ? profession.questions : openInterviewQuestions(profession);
  return (
    <main id="main" tabIndex={-1} className="ps-wrap ps-page iq-page">
      <Crumbs profession={profession} />
      <ProfessionHero
        profession={profession}
        vacancies={vacancies}
        open={open.length}
        unlocked={unlocked}
      />
      <div className="iq-grid">
        <div>
          <KindFilters questions={open} unlocked={unlocked} />
          <div className="iq-list">
            {open.map((question, index) => (
              <OpenQuestion
                key={question.id}
                question={question}
                profession={profession}
                first={index === 0}
              />
            ))}
          </div>
          {unlocked ? null : <LockedQuestions profession={profession} />}
          <ProfessionLinks profession={profession} vacancies={vacancies} related={related} />
        </div>
        <Quiz profession={profession} unlocked={unlocked} />
      </div>
      <TrainerStrip
        role={profession.slug}
        title="Отрепетируйте собеседование под конкретную вакансию"
      />
    </main>
  );
}
