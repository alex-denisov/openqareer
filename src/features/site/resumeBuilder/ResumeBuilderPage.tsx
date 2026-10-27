import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, FileText } from '@phosphor-icons/react';
import { PublicFooter, PublicHeader } from '../PublicSiteChrome';
import { SiteLink } from '../SiteLink';
import { ResumeEditor } from './ResumeEditor';
import { VacancyBox } from './VacancyBox';
import { RESUME_BUILDER_FAQ, RESUME_BUILDER_TITLE, RESUME_GUIDE } from './resumeBuilderContent';
import { useResumeBuilder, type ResumeBuilderModel } from './useResumeBuilder';

interface ResumeBuilderPageProps {
  readonly onNavigate: (path: string) => void;
  readonly signedIn?: boolean;
  readonly isAdmin?: boolean;
}

// One block of markup; splitting it would scatter a single layout.
// eslint-disable-next-line max-lines-per-function
function Hero({ model }: { readonly model: ResumeBuilderModel }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const scrollToBuilder = () =>
    document.getElementById('builder')?.scrollIntoView?.({ behavior: 'smooth' });
  return (
    <div>
      <span className="ps-label eyebrow">Конструктор резюме · 3 шаблона</span>
      <h1>Конструктор резюме онлайн: шаблоны и проверка на ATS</h1>
      <p className="lead">
        Заполните резюме по шагам прямо на этой странице: к каждому полю есть подсказка, как
        написать результат цифрой. Готовое резюме скачайте в PDF или DOCX.
      </p>
      <div className="src-row">
        <button
          type="button"
          className="ps-btn is-primary is-lg"
          onClick={() => {
            if (!model.editing) model.startBlank();
            scrollToBuilder();
          }}
        >
          Создать резюме
        </button>
        <button
          type="button"
          className="ps-btn is-lg"
          disabled={model.busy === 'upload'}
          onClick={() => fileInput.current?.click()}
        >
          <FileText className="ic" aria-hidden="true" />
          {model.busy === 'upload' ? 'Читаем файл…' : 'Загрузить готовое'}
        </button>
        <input
          ref={fileInput}
          type="file"
          hidden
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void model.uploadFile(file).then(scrollToBuilder);
          }}
        />
      </div>
      <ol className="how3">
        <li>
          <span className="n">1</span>
          <span>
            <b>Шаг за шагом.</b> Должность, результаты, опыт, образование, навыки — с примерами
            сильных формулировок.
          </span>
        </li>
        <li>
          <span className="n">2</span>
          <span>
            <b>Проверка на ATS сразу.</b> Структура, даты и формат проверяются по ходу; вставьте
            ссылку или текст вакансии — проверим и ключевые слова.
          </span>
        </li>
        <li>
          <span className="n">3</span>
          <span>
            <b>PDF и DOCX.</b> Скачать можно после регистрации: резюме сохранится в профиле, и его
            не придётся заполнять заново.
          </span>
        </li>
      </ol>
    </div>
  );
}

const CHIP_TEXT = { ok: 'в порядке', fix: 'поправить', needs_vacancy: 'нужна вакансия' } as const;

function ChecksSection({ model }: { readonly model: ResumeBuilderModel }) {
  return (
    <section className="ps-section" aria-labelledby="rb-checks">
      <div className="ps-wrap">
        <div className="ps-sh">
          <div>
            <p className="ps-label">Проверка на ATS</p>
            <h2 id="rb-checks">Видно, почему резюме не доходит до рекрутера</h2>
          </div>
          <p>
            Компании принимают отклики через ATS: система разбирает резюме и ищет слова из вакансии.
            Структуру, даты и формат проверяем сразу, ключевые слова — по вакансии: вставьте ссылку
            или текст.
          </p>
        </div>
        {/* Sideways on a phone: the row itself takes focus so the keyboard can scroll it. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
        <div className="checks" tabIndex={0} aria-label="Проверки, листаются вбок">
          {model.ats.checks.map((check) => (
            <div className="chk" key={check.id}>
              <div className="top">
                <h3>{check.title}</h3>
                <span className={check.status === 'ok' ? 'ps-chip is-ok' : 'ps-chip'}>
                  {check.id === 'format' && check.status === 'ok'
                    ? 'одна колонка'
                    : CHIP_TEXT[check.status]}
                </span>
              </div>
              <p>{check.detail}</p>
            </div>
          ))}
        </div>
        <VacancyBox model={model} />
      </div>
    </section>
  );
}

const GUIDE_FOLD = 2;

// One block of markup; splitting it would scatter a single layout.
// eslint-disable-next-line max-lines-per-function
function GuideSection({ onNavigate }: { readonly onNavigate: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const steps = open ? RESUME_GUIDE : RESUME_GUIDE.slice(0, GUIDE_FOLD);
  return (
    <section className="ps-section" aria-labelledby="how-to-write-a-resume">
      <div className="ps-wrap guide">
        <div>
          <div className="ps-sh">
            <div>
              <p className="ps-label">Гайд</p>
              <h2 id="how-to-write-a-resume">Как составить резюме: 5 шагов</h2>
            </div>
          </div>
          <ol>
            {steps.map((item) => (
              <li key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
                {item.example ? (
                  <div className="bad-good">
                    <div className="b">
                      <small>Слабо</small>
                      {item.example[0]}
                    </div>
                    <div className="g">
                      <small>Сильно</small>
                      {item.example[1]}
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="ps-btn rb-fold"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? 'Свернуть' : `Ещё ${RESUME_GUIDE.length - GUIDE_FOLD} шага`}
          </button>
        </div>
        <aside className="aside" aria-label="Собрать резюме">
          <b className="aside-title">Пусть ИИ сделает эти 5 шагов</b>
          <p>
            В кабинете ИИ задаст вопросы о ваших результатах, соберёт резюме и покажет вакансии, где
            оно подходит.
          </p>
          <ul>
            {[
              'Мастер-резюме из всех ваших фактов',
              'Версия под каждую вакансию на Basic и выше',
              'PDF и DOCX',
            ].map((text) => (
              <li key={text}>
                <Check className="ic" aria-hidden="true" />
                {text}
              </li>
            ))}
          </ul>
          <SiteLink
            to="/signup?from=resume"
            className="ps-btn is-primary is-lg"
            onNavigate={onNavigate}
          >
            Собрать резюме с ИИ
          </SiteLink>
        </aside>
      </div>
    </section>
  );
}

function FaqSection() {
  const half = Math.ceil(RESUME_BUILDER_FAQ.length / 3);
  const columns = [RESUME_BUILDER_FAQ.slice(0, half), RESUME_BUILDER_FAQ.slice(half)];
  return (
    <section
      className="ps-section"
      aria-labelledby="rb-faq"
      itemScope
      itemType="https://schema.org/FAQPage"
    >
      <div className="ps-wrap">
        <div className="ps-sh">
          <div>
            <p className="ps-label">Вопросы</p>
            <h2 id="rb-faq">О конструкторе</h2>
          </div>
          <p className="rb-links">
            <a className="link" href="/tools/country-fit">
              Сколько будет на руки <ArrowRight aria-hidden="true" />
            </a>
            <a className="link" href="/faq">
              Все вопросы и ответы <ArrowRight aria-hidden="true" />
            </a>
          </p>
        </div>
        <div className="ps-faq">
          {columns.map((column, index) => (
            <div key={index}>
              {column.map(([question, answer]) => (
                <details
                  key={question}
                  itemScope
                  itemProp="mainEntity"
                  itemType="https://schema.org/Question"
                >
                  <summary itemProp="name">{question}</summary>
                  <div itemScope itemProp="acceptedAnswer" itemType="https://schema.org/Answer">
                    <p itemProp="text">{answer}</p>
                  </div>
                </details>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalSection({ onNavigate }: { readonly onNavigate: (path: string) => void }) {
  return (
    <section className="ps-section rb-final">
      <div className="ps-wrap rb-final-row">
        <div>
          <h2>Старое резюме → новое за один сеанс</h2>
          <p>И сразу список вакансий, на которые с ним можно откликнуться.</p>
        </div>
        <SiteLink
          to="/signup?from=resume"
          className="ps-btn is-primary is-lg"
          onNavigate={onNavigate}
        >
          Загрузить резюме
        </SiteLink>
      </div>
    </section>
  );
}

/** B567: the public resume builder at /tools/resume. */
// One block of markup; splitting it would scatter a single layout.
// eslint-disable-next-line max-lines-per-function
export function ResumeBuilderPage({
  onNavigate,
  signedIn = false,
  isAdmin = false,
}: ResumeBuilderPageProps) {
  const model = useResumeBuilder(signedIn, onNavigate);
  useEffect(() => {
    document.title = RESUME_BUILDER_TITLE;
  }, []);
  return (
    <div className="ps rbp">
      <a className="ps-skip" href="#main">
        К содержимому
      </a>
      <PublicHeader
        onNavigate={onNavigate}
        onLanding={false}
        signedIn={signedIn}
        isAdmin={isAdmin}
      />
      <main id="main">
        <nav className="ps-wrap ps-crumbs" aria-label="Хлебные крошки">
          <a href="/">Главная</a> / <span aria-current="page">Конструктор резюме</span>
        </nav>
        <section className="phero">
          <div className="ps-wrap rb">
            <Hero model={model} />
            <ResumeEditor model={model} />
          </div>
        </section>
        <ChecksSection model={model} />
        <GuideSection onNavigate={onNavigate} />
        <FaqSection />
        <section className="ps-section rb-next" aria-labelledby="rb-next">
          <div className="ps-wrap">
            <h2 id="rb-next">Дальше</h2>
            <div className="rb-links">
              <a className="link" href="/vacancies">
                Вакансии, где подойдёт это резюме <ArrowRight aria-hidden="true" />
              </a>
              <a className="link" href="/faq">
                Все вопросы и ответы <ArrowRight aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>
        <FinalSection onNavigate={onNavigate} />
      </main>
      <PublicFooter onNavigate={onNavigate} onLanding={false} signedIn={signedIn} />
    </div>
  );
}
