import { createContext, useContext, type ReactNode } from 'react';
import {
  HIDDEN_TEXT_COPY,
  vacancySummaryText,
  type VacancyDetailState,
} from '../../vacancies/vacancyDetailApi';
import { InfoTip, StatusLine } from '../kit';
import { paragraphs, type ApplyHead } from './model/applyModel';

/** Текст вакансии читается один раз на весь экран: шаги и ожидание его не перечитывают (B798). */
export const VacancyText = createContext<VacancyDetailState>({ status: 'idle' });

export type VacancyTextView =
  | { readonly kind: 'loading' | 'hidden' | 'missing' }
  | { readonly kind: 'text'; readonly text: string };

const LOADING: VacancyTextView = { kind: 'loading' };

/**
 * Что показать слева: полный текст, иначе выжимка, иначе описание из записи отклика. `waiting` —
 * запись ещё читается, и говорить «не загрузилось» рано.
 */
export function vacancyTextView(
  detail: VacancyDetailState,
  fallbacks: readonly (string | null | undefined)[],
  waiting = false,
): VacancyTextView {
  const full = detail.status === 'ready' ? detail.detail.description.trim() : '';
  if (full) return { kind: 'text', text: detail.status === 'ready' ? detail.detail.description : full };
  const summary = vacancySummaryText('', detail);
  if (summary.loading) return LOADING;
  const known = [summary.text, ...fallbacks].find((text) => text?.trim());
  if (known) return { kind: 'text', text: known };
  if (waiting) return LOADING;
  return { kind: summary.hidden ? 'hidden' : 'missing' };
}

export interface VacancyColumnProps {
  readonly head: Pick<ApplyHead, 'title' | 'source'>;
  /** Описания из записей, уже прочитанных экраном: выжимка подборки, снимок отклика. */
  readonly fallbacks?: readonly (string | null | undefined)[];
  readonly waiting?: boolean;
  readonly children?: ReactNode;
}

/** Левая колонка: текст вакансии, под которую идёт отклик. */
export function VacancyColumn({ head, fallbacks = [], waiting, children }: VacancyColumnProps) {
  const view = vacancyTextView(useContext(VacancyText), fallbacks, waiting);
  return (
    <div className="col vac-col">
      <section className="mod" aria-labelledby="vp-title">
        <div className="lead-head">
          <h3 className="mod-title" id="vp-title">
            {head.title}
          </h3>
          {head.source ? (
            <InfoTip label="Источник" text={`Текст вакансии: ${head.source}.`} />
          ) : null}
        </div>
        {view.kind === 'loading' ? (
          <p className="ls-state" role="status">
            Загружаем текст вакансии…
          </p>
        ) : null}
        {view.kind === 'missing' ? (
          <StatusLine state="err" text="Текст вакансии не загрузился" />
        ) : null}
        {view.kind === 'hidden' ? <p className="mod-text">{HIDDEN_TEXT_COPY}</p> : null}
        {view.kind === 'text' ? (
          // B645: длинный текст прокручивается внутри карточки и не растягивает страницу.
          <div
            className="letter full vac-text"
            role="region"
            aria-label="Текст вакансии"
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Фокус нужен для прокрутки текста с клавиатуры.
            tabIndex={0}
          >
            {paragraphs(view.text).map((line, index) => (
              <div key={`${index}-${line.slice(0, 24)}`}>{line}</div>
            ))}
          </div>
        ) : null}
      </section>
      {children}
    </div>
  );
}
