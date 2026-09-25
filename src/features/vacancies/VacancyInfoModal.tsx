import { Info } from '@phosphor-icons/react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { vacancySourceLabels } from '../../../shared/vacancySourceLabel';
import { openExternalLink } from '../../services/desktop/openExternalLink';
import { ImportModalShell } from '../connections/ImportModalShell';
import { useVacancyDetail, type VacancyDetailState } from './vacancyDetailApi';

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
  const sources = vacancySourceLabels(cluster.sources);
  const detail = useVacancyDetail(cluster.id, isOpen);
  const skills =
    detail.status === 'ready' && detail.detail.skills.length > 0
      ? detail.detail.skills
      : cluster.skills;
  return (
    <ImportModalShell
      isOpen={isOpen}
      onClose={onClose}
      titleId="vacancy-info-title"
      title={cluster.canonicalTitle}
      icon={<Info size={18} aria-hidden="true" />}
    >
      <div className="career-modal-body vacancies-info-body">
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

        {cluster.primaryUrl ? (
          <button
            type="button"
            className="vacancies-btn vacancies-btn-secondary"
            onClick={() => {
              void openExternalLink(cluster.primaryUrl);
            }}
          >
            Открыть на площадке
          </button>
        ) : null}
      </div>
    </ImportModalShell>
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
  return (
    <div className="vacancies-info-description">
      {text
        .split(/\n{2,}|\n/u)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
    </div>
  );
}

function infoSubtitle(cluster: MatchedVacancyItem['cluster']): string {
  return [cluster.canonicalCompany, cluster.canonicalLocation, cluster.isRemote ? 'удалённо' : null]
    .filter(Boolean)
    .join(' · ');
}
