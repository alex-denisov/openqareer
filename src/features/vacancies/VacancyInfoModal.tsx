import { ArrowSquareOut } from '@phosphor-icons/react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { vacancySourceLabels } from '../../../shared/vacancySourceLabel';
import { openExternalLink } from '../../services/desktop/openExternalLink';
import { ImportModalShell } from '../connections/ImportModalShell';
import { useVacancyDetail, type VacancyDetailState } from './vacancyDetailApi';
import { parseDescriptionSections } from './vacancyDescriptionSections';
import { decodeVacancyText } from './vacancyText';

interface VacancyInfoModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly cluster: MatchedVacancyItem['cluster'];
}

/**
 * «Полное описание» (B266 P0-2, B549 mockup 4): the full text opens in-app,
 * split into the vacancy's own sections; only «Открыть на площадке» leaves
 * the app, through `openExternalLink`. Recruiter contacts live in the company
 * path and «Компании и люди», not in this window.
 */
export function VacancyInfoModal({ isOpen, onClose, cluster }: VacancyInfoModalProps) {
  const detail = useVacancyDetail(cluster.id, isOpen);
  return (
    <ImportModalShell
      isOpen={isOpen}
      onClose={onClose}
      titleId="vacancy-info-title"
      title={cluster.canonicalTitle}
      icon={null}
      detail
      className="career-token-scope"
    >
      <div className="career-modal-body vacancies-info-body vacancies-info-scroll">
        <p className="vacancies-info-subtitle">{infoSubtitle(cluster)}</p>
        <VacancyDescription detail={detail} summary={cluster.descriptionSummary} />
      </div>
      <VacancyInfoFooter primaryUrl={cluster.primaryUrl} onClose={onClose} />
    </ImportModalShell>
  );
}

function VacancyInfoFooter({
  primaryUrl,
  onClose,
}: {
  readonly primaryUrl: string;
  readonly onClose: () => void;
}) {
  return (
    <div className="career-modal-footer vacancies-info-footer">
      {primaryUrl ? (
        <button
          type="button"
          className="career-btn career-btn-secondary vacancies-info-btn"
          onClick={() => {
            void openExternalLink(primaryUrl);
          }}
        >
          <ArrowSquareOut size={15} aria-hidden="true" />
          Открыть на площадке
        </button>
      ) : null}
      <button
        type="button"
        className="career-btn career-btn-secondary vacancies-info-btn"
        onClick={onClose}
      >
        Закрыть
      </button>
    </div>
  );
}

function VacancyDescription({
  detail,
  summary,
}: {
  readonly detail: VacancyDetailState;
  readonly summary: string;
}) {
  if (detail.status === 'loading' || detail.status === 'idle') {
    return <p className="vacancies-info-description is-empty">Загружаем описание…</p>;
  }
  const text = detail.status === 'ready' ? detail.detail.description : decodeVacancyText(summary);
  if (!text) {
    return (
      <p className="vacancies-info-description is-empty">
        Площадка не отдала текст вакансии — откройте её на площадке.
      </p>
    );
  }
  const partial = detail.status === 'ready' && detail.detail.truncated;
  const sections = parseDescriptionSections(text);
  return (
    <div className="vacancies-info-description">
      {sections ? <SectionedDescription sections={sections} /> : <DescriptionBlocks text={text} />}
      {partial ? (
        <p className="is-empty">
          Площадка отдала только начало описания — полный текст откройте на площадке.
        </p>
      ) : null}
    </div>
  );
}

function SectionedDescription({
  sections,
}: {
  readonly sections: NonNullable<ReturnType<typeof parseDescriptionSections>>;
}) {
  return (
    <>
      {sections.intro.map((line, index) => (
        <p key={`intro-${index}`}>{line}</p>
      ))}
      {sections.sections.map((section, index) => (
        <section key={`${section.title}-${index}`}>
          <h4>{section.title}</h4>
          <SectionBody section={section} />
        </section>
      ))}
    </>
  );
}

/** Source list lines stay a list; beside them paragraphs and subheadings stay
 *  paragraphs (Workday: «Product Strategy» above its bullets, 26.10). A section
 *  with no markers at all is a list, as in mockup 4 (B549). */
function SectionBody({
  section,
}: {
  readonly section: NonNullable<ReturnType<typeof parseDescriptionSections>>['sections'][number];
}) {
  const hasList = section.bullets.some(Boolean);
  const groups = section.items.reduce<{ list: boolean; items: string[] }[]>((acc, item, index) => {
    const list = !hasList || (section.bullets[index] ?? true);
    const last = acc.at(-1);
    return last && last.list && list
      ? [...acc.slice(0, -1), { list, items: [...last.items, item] }]
      : [...acc, { list, items: [item] }];
  }, []);
  return groups.map((group, index) =>
    group.list ? (
      <ul key={index}>
        {group.items.map((item, itemIndex) => (
          <li key={`${itemIndex}-${item}`}>{item}</li>
        ))}
      </ul>
    ) : (
      <p key={index}>{group.items[0]}</p>
    ),
  );
}

function DescriptionBlocks({ text }: { readonly text: string }) {
  const paragraphs = text
    .split(/\n{2,}/u)
    .map((part) => part.trim())
    .filter(Boolean);
  return paragraphs.map((paragraph, index) => {
    const lines = paragraph
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const list = lines.every((line) => /^[-*]\s+/u.test(line));
    if (list) {
      return (
        <ul key={index}>
          {lines.map((line) => (
            <li key={line}>{line.replace(/^[-*]\s+/u, '')}</li>
          ))}
        </ul>
      );
    }
    return <p key={index}>{lines.join(' ')}</p>;
  });
}

function observedDay(value: string | undefined): string | null {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(new Date(value));
}

/**
 * «Вектор Банк · hh.ru, 05.10 · полный текст вакансии» (mockup 4). The date is
 * the row's: when the named source last showed the vacancy (G5 M3), not when
 * the cluster was first seen.
 */
function infoSubtitle(cluster: MatchedVacancyItem['cluster']): string {
  const source = vacancySourceLabels(cluster.sources)[0];
  const day = observedDay(cluster.sources[0]?.observedAt ?? cluster.firstObservedAt);
  const origin = [source, day].filter(Boolean).join(', ');
  return [cluster.canonicalCompany, origin || null, 'полный текст вакансии']
    .filter(Boolean)
    .join(' · ');
}
