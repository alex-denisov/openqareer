import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Briefcase,
  CheckCircle,
  Sparkle,
  WarningCircle,
} from '@phosphor-icons/react';
import {
  getMatchedVacancies,
  type MatchedVacancyItem,
} from '../coach/coachApi';

interface ResumeTargetVacanciesBlockProps {
  selectedClusterId?: string;
  onSelectTargetVacancy?: (item: MatchedVacancyItem) => void;
}

function TargetVacancyHeader({ item }: { item: MatchedVacancyItem }) {
  const fitBadgeClass = fitLevelClass(item.explanation.fitLevel);
  const fitLabel = fitLevelLabel(item.explanation.fitLevel);
  return (
    <div className="career-resume-target-header">
      <div>
        <strong>{item.cluster.canonicalTitle}</strong>
        <small>
          {item.cluster.canonicalCompany} ·{' '}
          {item.cluster.canonicalLocation || (item.cluster.isRemote ? 'Remote' : 'Локация не указана')}
        </small>
      </div>
      <span className={`career-match-badge ${fitBadgeClass}`}>
        {item.explanation.matchScore}% · {fitLabel}
      </span>
    </div>
  );
}

function TargetVacancyPoints({ item }: { item: MatchedVacancyItem }) {
  const hasMatching = item.explanation.matchingPoints.length > 0;
  const hasMissing = item.explanation.missingPoints.length > 0;
  return (
    <>
      {hasMatching ? (
        <div className="career-resume-target-points is-matched">
          <CheckCircle size={13} weight="fill" />
          <span>
            Совпало:{' '}
            {item.explanation.matchingPoints
              .slice(0, 3)
              .map((p) => p.replace(/^Подтверждённый навык:\s*/i, ''))
              .join(', ')}
          </span>
        </div>
      ) : null}
      {hasMissing ? (
        <div className="career-resume-target-points is-missing">
          <WarningCircle size={13} weight="fill" />
          <span>
            Требуется в резюме:{' '}
            {item.explanation.missingPoints.slice(0, 3).join(', ')}
          </span>
        </div>
      ) : null}
    </>
  );
}

function TargetVacancyActions({
  item,
  isSelected,
  onSelect,
}: {
  item: MatchedVacancyItem;
  isSelected: boolean;
  onSelect?: (item: MatchedVacancyItem) => void;
}) {
  return (
    <div className="career-resume-target-actions">
      <a
        href={item.cluster.primaryUrl}
        target="_blank"
        rel="noreferrer"
        className="career-target-link"
      >
        <Briefcase size={13} /> Открыть в источнике
      </a>
      {onSelect ? (
        <button
          type="button"
          className={`career-target-select-btn ${isSelected ? 'is-active' : ''}`}
          onClick={() => onSelect(item)}
        >
          {isSelected ? 'Выбрана как цель' : 'Адаптировать резюме'} <ArrowRight size={13} />
        </button>
      ) : null}
    </div>
  );
}

function TargetVacancyCard({
  item,
  selectedClusterId,
  onSelectTargetVacancy,
}: {
  item: MatchedVacancyItem;
  selectedClusterId?: string;
  onSelectTargetVacancy?: (item: MatchedVacancyItem) => void;
}) {
  const isSelected = selectedClusterId === item.cluster.id;
  return (
    <li className={`career-resume-target-item ${isSelected ? 'is-selected' : ''}`}>
      <TargetVacancyHeader item={item} />
      <TargetVacancyPoints item={item} />
      <TargetVacancyActions item={item} isSelected={isSelected} onSelect={onSelectTargetVacancy} />
    </li>
  );
}

function useMatchedVacancies() {
  const [matched, setMatched] = useState<MatchedVacancyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void getMatchedVacancies()
      .then((data) => {
        if (active) setMatched(data);
      })
      .catch(() => {
        // A failed reading is not an empty market; saying nothing at all is how
        // «источник недоступен» became indistinguishable from «ничего нет».
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return { matched, loading, failed };
}

function TargetVacanciesLoading() {
  return (
    <section className="career-resume-rail-block" aria-busy="true">
      <h3>
        <Sparkle size={16} /> Подбор вакансий из пула…
      </h3>
      <p>Ранжируем вакансии из Telegram-каналов и агрегаторов под ваш стек.</p>
    </section>
  );
}

export function ResumeTargetVacanciesBlock({
  selectedClusterId,
  onSelectTargetVacancy,
}: ResumeTargetVacanciesBlockProps) {
  const { matched, loading, failed } = useMatchedVacancies();

  if (loading) return <TargetVacanciesLoading />;
  if (failed) {
    return (
      <section className="career-resume-rail-block" role="status">
        <h3>
          <Sparkle size={16} /> Целевые вакансии
        </h3>
        <p>
          Подбор вакансий сейчас недоступен — источник не ответил. Данные профиля
          не затронуты, повторите позже.
        </p>
      </section>
    );
  }
  if (matched.length === 0) return null;

  return (
    <section className="career-resume-rail-block" aria-label="Целевые вакансии">
      <h3>
        <Sparkle size={16} /> Целевые вакансии ({matched.length})
      </h3>
      <p>Рейтинг позиций из Telegram-каналов и агрегаторов на основе подтверждённых навыков.</p>
      <ul className="career-resume-target-vacancies">
        {matched.slice(0, 5).map((item) => (
          <TargetVacancyCard
            key={item.cluster.id}
            item={item}
            selectedClusterId={selectedClusterId}
            onSelectTargetVacancy={onSelectTargetVacancy}
          />
        ))}
      </ul>
    </section>
  );
}


function fitLevelClass(level: string): string {
  switch (level) {
    case 'strong':
      return 'is-strong';
    case 'good':
      return 'is-good';
    case 'potential':
      return 'is-potential';
    default:
      return 'is-low';
  }
}

function fitLevelLabel(level: string): string {
  switch (level) {
    case 'strong':
      return 'Сильное';
    case 'good':
      return 'Хорошее';
    case 'potential':
      return 'Потенциал';
    default:
      return 'Базовое';
  }
}

