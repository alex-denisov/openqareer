import { Info } from '@phosphor-icons/react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { vacancySourceLabels } from '../../../shared/vacancySourceLabel';
import { openExternalLink } from '../../services/desktop/openExternalLink';
import { ImportModalShell } from '../connections/ImportModalShell';
import { useVacancyDetail, type VacancyDetailState } from './vacancyDetailApi';
import { RecruiterContactsBlock } from './RecruiterContactsBlock';
import { recruiterEnrichPayload } from './recruiterEnrichPayload';

interface VacancyInfoModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly cluster: MatchedVacancyItem['cluster'];
}

/**
 * «Подробнее» (B266 P0-2): the row was a bare `target="_blank"` anchor,
 * which the Tauri WebView silently drops. The full description now opens
 * in-app; only the outbound link to the source board leaves the app, and it
 * goes through `openExternalLink` (system browser on desktop, new tab on
 * web) instead of a dead anchor.
 */
export function VacancyInfoModal({ isOpen, onClose, cluster }: VacancyInfoModalProps) {
  const detail = useVacancyDetail(cluster.id, isOpen);
  return (
    <ImportModalShell
      isOpen={isOpen}
      onClose={onClose}
      titleId="vacancy-info-title"
      title={cluster.canonicalTitle}
      icon={<Info size={18} aria-hidden="true" />}
      detail
    >
      <VacancyInfoContent cluster={cluster} detail={detail} />
      <VacancyInfoFooter primaryUrl={cluster.primaryUrl} />
    </ImportModalShell>
  );
}

/** Scrollable body (B250): everything except the header and the pinned
 *  «Открыть на площадке» panel, which `ImportModalShell` keeps in place. */
function VacancyInfoContent({
  cluster,
  detail,
}: {
  readonly cluster: MatchedVacancyItem['cluster'];
  readonly detail: VacancyDetailState;
}) {
  const sources = vacancySourceLabels(cluster.sources);
  const skills =
    detail.status === 'ready' && detail.detail.skills.length > 0
      ? detail.detail.skills
      : cluster.skills;
  return (
    <div className="career-modal-body vacancies-info-body vacancies-info-scroll">
      <p className="vacancies-info-subtitle">{infoSubtitle(cluster)}</p>

      <VacancyDescription detail={detail} summary={cluster.descriptionSummary} />

      {skills.length > 0 ? (
        <ul className="vacancies-info-skills">
          {skills.map((skill) => (
            <li key={skill}>{skill}</li>
          ))}
        </ul>
      ) : null}

      {sources.length > 0 ? (
        <p className="vacancies-info-sources">Источники: {sources.join(', ')}</p>
      ) : null}

      <div className="vacancies-info-recruiter">
        <h4>Кто нанимает</h4>
        <RecruiterContactsBlock
          vacancyId={cluster.id}
          vacancyPayload={recruiterEnrichPayload(cluster)}
        />
      </div>
    </div>
  );
}

function VacancyInfoFooter({ primaryUrl }: { readonly primaryUrl: string }) {
  if (!primaryUrl) return null;
  return (
    <div className="career-modal-footer vacancies-info-footer">
      <button
        type="button"
        className="vacancies-btn vacancies-btn-secondary"
        onClick={() => {
          void openExternalLink(primaryUrl);
        }}
      >
        Открыть на площадке
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
  const text = detail.status === 'ready' ? detail.detail.description : summary;
  if (!text) {
    return (
      <p className="vacancies-info-description is-empty">
        Площадка не отдала текст вакансии — откройте её на площадке.
      </p>
    );
  }
  const partial = detail.status === 'ready' && detail.detail.truncated;
  return (
    <div className="vacancies-info-description">
      <DescriptionBlocks text={text} />
      {partial ? (
        <p className="is-empty">
          Площадка отдала только начало описания — полный текст откройте на площадке.
        </p>
      ) : null}
    </div>
  );
}

function DescriptionBlocks({ text }: { readonly text: string }) {
  const paragraphs = text.split(/\n{2,}/u).map((part) => part.trim()).filter(Boolean);
  return paragraphs.map((paragraph, index) => {
    const lines = paragraph.split('\n').map((line) => line.trim()).filter(Boolean);
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

function infoSubtitle(cluster: MatchedVacancyItem['cluster']): string {
  return [cluster.canonicalCompany, cluster.canonicalLocation, cluster.isRemote ? 'удалённо' : null]
    .filter(Boolean)
    .join(' · ');
}
