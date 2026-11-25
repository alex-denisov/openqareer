import { useState, type ReactNode } from 'react';
import type { VacancyFitView } from '../../../../../shared/vacancyFit';
import { useVacancyDetail, type VacancyDetailState } from '../../../vacancies/vacancyDetailApi';
import { Icon, StatusLine } from '../../kit';
import { textBlocks } from './textBlocks';
import { vacancySections, type VacancySections } from './vacancyTextView';

export interface SourceLink {
  readonly url: string;
  readonly label: string;
}

export interface VacancyTextProps {
  readonly clusterId: string;
  readonly fit: VacancyFitView | undefined;
  /** Ссылка на площадку; `undefined` — она уже есть в «Как откликнуться». */
  readonly source: SourceLink | undefined;
}

function Section({ children }: { readonly children: ReactNode }) {
  return (
    <section className="mod vt-txt" aria-label="Вакансия">
      {children}
    </section>
  );
}

function List({ title, children }: { readonly title: string; readonly children: ReactNode[] }) {
  if (children.length === 0) return null;
  return (
    <div>
      <h4>{title}</h4>
      <ul>{children}</ul>
    </div>
  );
}

function Sections({ duties, requirements, conditions }: VacancySections) {
  return (
    <Section>
      <List title="Задачи">
        {duties.map((text, index) => (
          <li key={index}>{text}</li>
        ))}
      </List>
      <List title="Требования">
        {requirements.map(({ text, mark }, index) => (
          <li key={index}>
            {text}
            {mark ? (
              <>
                {' · '}
                <span className={mark === 'желательно' ? 'wish' : 'miss'}>{mark}</span>
              </>
            ) : null}
          </li>
        ))}
      </List>
      <List title="Условия">
        {conditions.map((text, index) => (
          <li key={index}>{text}</li>
        ))}
      </List>
    </Section>
  );
}

function Paragraphs({ description }: { readonly description: string }) {
  return (
    <Section>
      <div>
        {textBlocks(description).map((block, index) =>
          block.kind === 'h' ? <h4 key={index}>{block.text}</h4> : <p key={index}>{block.text}</p>,
        )}
      </div>
    </Section>
  );
}

function Skeleton() {
  return (
    <section
      className="mod vt-txt is-skel"
      role="status"
      aria-busy="true"
      aria-label="Читаем текст вакансии"
    >
      <span />
      <span />
      <span />
      <span />
    </section>
  );
}

function SourceRow({ source }: { readonly source: SourceLink | undefined }) {
  if (!source) return null;
  return (
    <a className="row-act vt-src" href={source.url} target="_blank" rel="noopener noreferrer">
      <Icon name="out" />
      {source.label}
    </a>
  );
}

function isReading(state: VacancyDetailState): boolean {
  if (state.status === 'idle' || state.status === 'loading') return true;
  return state.status === 'ready' && Boolean(state.detail.pending);
}

function ReadText({ clusterId, fit, source, onRetry }: VacancyTextProps & { onRetry: () => void }) {
  const state = useVacancyDetail(clusterId, true);
  if (isReading(state)) return <Skeleton />;
  if (state.status !== 'ready') {
    return (
      <StatusLine
        state="err"
        text="Не удалось загрузить текст"
        action={
          <button className="btn is-sm" type="button" onClick={onRetry}>
            Повторить
          </button>
        }
      />
    );
  }
  const { brief, textHidden, description } = state.detail;
  if (!brief || textHidden) return <SourceRow source={source} />;
  const sections = vacancySections(brief, fit);
  return sections ? (
    <Sections {...sections} />
  ) : (
    <Paragraphs description={description || brief.opening} />
  );
}

/** Текст вакансии под «Откликнуться» (B800): задачи, требования и условия её же строками. */
export function VacancyText(props: VacancyTextProps) {
  const [attempt, setAttempt] = useState(0);
  return (
    <ReadText
      key={`${props.clusterId}:${attempt}`}
      {...props}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}
