import { useState, useMemo } from 'react';
import {
  CheckCircle,
  Info,
  MagnifyingGlass,
  Plugs,
  WarningCircle,
} from '@phosphor-icons/react';
import type { CandidateMemory } from '../coach/coachApi';
import {
  conventionLines,
  evidenceStatementLabel,
  staleReasonLabel,
  unknownGroupLabel,
} from './resumeLabels';
import { orderUnknowns, eligibleEvidence } from './resumeStudioModel';
import { resumeSourceCoverage, type ImportedSource } from './resumeSourceCoverage';
import { ResumeTargetVacanciesBlock } from './ResumeTargetVacanciesBlock';
import { usedEvidenceIds } from './resumeDocumentRows';
import type {
  ResumeConventions,
  ResumeDocument,
  ResumeDraft,
  ResumeEvidenceFreshness,
  ResumeUnknown,
} from './resumeTypes';

export type FactCategory = 'all' | 'experience' | 'skills' | 'education' | 'languages';

interface ResumeDossierRailProps {
  readonly memory: readonly CandidateMemory[];
  readonly draft: ResumeDraft;
  readonly document: ResumeDocument;
  readonly freshness: ResumeEvidenceFreshness;
  readonly excludedEvidenceIds: readonly string[];
  readonly importedSource?: ImportedSource;
  readonly documentEdited?: boolean;
  readonly onUnknownClick?: (unknown: ResumeUnknown) => void;
  readonly onAddEvidenceToDraft?: (memoryId: string) => void;
}

function computeCategoryCounts(facts: readonly CandidateMemory[]): Record<FactCategory, number> {
  const counts: Record<FactCategory, number> = {
    all: facts.length,
    experience: 0,
    skills: 0,
    education: 0,
    languages: 0,
  };
  for (const item of facts) {
    counts[getFactCategory(item)]++;
  }
  return counts;
}

function filterFacts(
  facts: readonly CandidateMemory[],
  category: FactCategory,
  query: string,
): readonly CandidateMemory[] {
  const trimmed = query.trim().toLowerCase();
  return facts.filter((item) => {
    if (category !== 'all' && getFactCategory(item) !== category) return false;
    return !trimmed || item.statement.toLowerCase().includes(trimmed);
  });
}

const FACT_CATEGORIES: readonly { id: FactCategory; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'experience', label: 'Опыт' },
  { id: 'skills', label: 'Навыки' },
  { id: 'education', label: 'Образование' },
  { id: 'languages', label: 'Языки' },
];

function FactCategoryTabs({
  selected,
  counts,
  onSelect,
}: {
  readonly selected: FactCategory;
  readonly counts: Record<FactCategory, number>;
  readonly onSelect: (cat: FactCategory) => void;
}) {
  return (
    <nav className="career-resume-fact-tabs" aria-label="Категории фактов">
      {FACT_CATEGORIES.map((cat) => (
        <button
          key={cat.id}
          type="button"
          className={selected === cat.id ? 'is-active' : ''}
          aria-pressed={selected === cat.id}
          onClick={() => onSelect(cat.id)}
        >
          {cat.label} ({counts[cat.id]})
        </button>
      ))}
    </nav>
  );
}

function FactCard({
  item,
  inResume,
  staleReasons,
  isExcluded,
}: {
  readonly item: CandidateMemory;
  readonly inResume: boolean;
  readonly staleReasons?: readonly string[];
  readonly isExcluded: boolean;
}) {
  const provenance = getFactProvenance(item);

  return (
    <article
      className={`career-resume-fact-card ${inResume ? 'is-in-resume' : 'is-available'} ${
        staleReasons ? 'is-stale' : ''
      }`}
    >
      <p className="career-resume-fact-statement">{item.statement}</p>
      <div className="career-resume-fact-meta">
        <span className={`career-resume-badge is-provenance is-${provenance.kind}`}>
          {provenance.label}
        </span>
        <span className={`career-resume-badge is-usage ${inResume ? 'is-used' : 'is-available'}`}>
          {inResume ? 'В резюме' : 'Доступно для добавления'}
        </span>
        {staleReasons ? (
          <span className="career-resume-badge is-stale-alert">
            <WarningCircle size={12} weight="fill" />
            Устарел
          </span>
        ) : null}
        {isExcluded ? (
          <span className="career-resume-badge is-excluded-badge">Исключён</span>
        ) : null}
      </div>
    </article>
  );
}

function FactCardsList({
  items,
  used,
  staleMap,
  excludedSet,
  hasFilter,
}: {
  readonly items: readonly CandidateMemory[];
  readonly used: ReadonlySet<string>;
  readonly staleMap: ReadonlyMap<string, readonly string[]>;
  readonly excludedSet: ReadonlySet<string>;
  readonly hasFilter: boolean;
}) {
  if (items.length === 0) {
    return (
      <p className="career-resume-facts-empty">
        {hasFilter ? 'Ни один факт не соответствует запросу' : 'В этой категории фактов пока нет'}
      </p>
    );
  }

  return (
    <div className="career-resume-fact-cards">
      {items.map((item) => (
        <FactCard
          key={item.id}
          item={item}
          inResume={used.has(item.id)}
          staleReasons={staleMap.get(item.id)}
          isExcluded={excludedSet.has(item.id) || item.status === 'proposed'}
        />
      ))}
    </div>
  );
}

interface DossierFactsSectionProps {
  readonly memory: readonly CandidateMemory[];
  readonly draft: ResumeDraft;
  readonly freshness: ResumeEvidenceFreshness;
  readonly excludedEvidenceIds: readonly string[];
}

function DossierFactsSection({
  memory,
  draft,
  freshness,
  excludedEvidenceIds,
}: DossierFactsSectionProps) {
  const [selectedCategory, setSelectedCategory] = useState<FactCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const eligibleFacts = useMemo(() => eligibleEvidence(memory), [memory]);
  const used = useMemo(() => usedEvidenceIds(draft), [draft]);
  const staleMap = useMemo(
    () => new Map(freshness.stale.map((s) => [s.memoryId, s.reasons])),
    [freshness.stale],
  );
  const excludedSet = useMemo(() => new Set(excludedEvidenceIds), [excludedEvidenceIds]);
  const categoryCounts = useMemo(() => computeCategoryCounts(eligibleFacts), [eligibleFacts]);
  const filteredMemory = useMemo(
    () => filterFacts(eligibleFacts, selectedCategory, searchQuery),
    [eligibleFacts, selectedCategory, searchQuery],
  );

  return (
    <section className="career-resume-rail-block career-resume-facts-block">
      <div className="career-resume-facts-header">
        <h3>Подтверждённые факты ({eligibleFacts.length})</h3>
      </div>
      <div className="career-resume-search-wrapper">
        <MagnifyingGlass size={14} className="career-resume-search-icon" aria-hidden />
        <input
          type="search"
          className="career-resume-rail-search"
          placeholder="Поиск по фактам..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>
      <FactCategoryTabs selected={selectedCategory} counts={categoryCounts} onSelect={setSelectedCategory} />
      <FactCardsList
        items={filteredMemory}
        used={used}
        staleMap={staleMap}
        excludedSet={excludedSet}
        hasFilter={Boolean(searchQuery)}
      />
    </section>
  );
}

export function ResumeDossierRail({
  memory,
  draft,
  document,
  freshness,
  excludedEvidenceIds,
  importedSource,
  documentEdited = false,
  onUnknownClick,
}: ResumeDossierRailProps) {
  const unknowns = useMemo(() => orderUnknowns(document.unknowns), [document.unknowns]);

  return (
    <aside
      className="career-resume-rail career-resume-dossier-rail"
      aria-label="Пульт подтверждённых фактов кандидата"
    >
      <ResumeTargetVacanciesBlock />

      <ImportedSourceBlock
        source={importedSource}
        draft={draft}
        edited={documentEdited}
      />

      <UnknownsBlock unknowns={unknowns} onUnknownClick={onUnknownClick} />

      <FreshnessBlock freshness={freshness} memory={memory} />

      <ExcludedBlock memoryIds={excludedEvidenceIds} memory={memory} />

      <DossierFactsSection
        memory={memory}
        draft={draft}
        freshness={freshness}
        excludedEvidenceIds={excludedEvidenceIds}
      />

      <ConventionsBlock conventions={document.conventions} />
    </aside>
  );
}

export function getFactCategory(item: CandidateMemory): FactCategory {
  const statement = item.statement.toLowerCase();
  const id = item.id.toLowerCase();

  if (
    id.includes('-lang-') ||
    (item.domain === 'other' &&
      /язык|cefr|english|german|russian|french|spanish|английск|немецк|русск|французск|испанск/iu.test(
        statement,
      )) ||
    /уровень языка|английский|немецкий|english|cefr/iu.test(statement)
  ) {
    return 'languages';
  }

  if (
    id.includes('-edu-') ||
    id.includes('-course-') ||
    id.includes('-cert-') ||
    /образовани|вуз|университет|институт|бакалавр|магистр|диплом|сертификат|курс|degree|university|bachelor|master|msc|bsc|mba/iu.test(
      statement,
    )
  ) {
    return 'education';
  }

  if (
    item.domain === 'skill' ||
    id.includes('-skill-') ||
    /навык|стек|технологи|инструмент|skills|tech stack/iu.test(statement)
  ) {
    return 'skills';
  }

  return 'experience';
}

export function getFactProvenance(item: CandidateMemory): {
  label: string;
  kind: 'hh' | 'linkedin' | 'coach';
} {
  const id = item.id.toLowerCase();
  const sourceMsgs = (item.sourceMessageIds ?? []).join(' ').toLowerCase();

  if (id.includes('hh') || sourceMsgs.includes('hh')) {
    return { label: 'hh.ru', kind: 'hh' };
  }
  if (id.includes('linkedin') || sourceMsgs.includes('linkedin')) {
    return { label: 'LinkedIn', kind: 'linkedin' };
  }
  return { label: 'Диалог с консультантом', kind: 'coach' };
}

function ImportedSourceBlock({
  source,
  draft,
  edited,
}: {
  source?: ImportedSource;
  draft: ResumeDraft;
  edited: boolean;
}) {
  if (!source) return null;
  const { filled, empty } = resumeSourceCoverage(draft);
  return (
    <section className="career-resume-rail-block">
      <h3>
        <Plugs size={15} /> Что дал источник
      </h3>
      <p>
        Импорт из {source.label} от {importDate(source.importedAt)} · Фактов о вас:{' '}
        {source.factCount}
      </p>
      {filled.length > 0 ? (
        <ul className="career-resume-conventions" aria-label="Заполненные разделы">
          {filled.map((section) => (
            <li key={section.id}>
              {section.label}
              {section.count === null ? '' : ` — ${section.count}`}
            </li>
          ))}
        </ul>
      ) : null}
      {empty.length > 0 ? (
        <>
          <p>
            {edited ? 'Пусто' : 'В источнике не было'}:{' '}
            {empty.map((section) => section.label).join(', ')}.
          </p>
          <p>
            Добавьте их вручную — резюме не придумывает того, чего в источнике
            нет.
          </p>
        </>
      ) : null}
    </section>
  );
}

function importDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return 'последнего импорта';
  return parsed.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function FreshnessBlock({
  freshness,
  memory,
}: {
  freshness: ResumeEvidenceFreshness;
  memory: readonly CandidateMemory[];
}) {
  if (freshness.stale.length === 0) return null;
  return (
    <section className="career-resume-rail-block is-alert" role="alert">
      <h3>
        <WarningCircle size={16} weight="fill" /> Требует обновления ({freshness.stale.length})
      </h3>
      <p>
        Факты, на которых построено резюме, изменились в вашем профиле или были
        отозваны. Сохраните резюме заново, чтобы зафиксировать актуальные.
      </p>
      <ul className="career-resume-stale">
        {freshness.stale.map((item) => (
          <li key={item.memoryId}>
            <span className="career-resume-evidence-line">
              {evidenceStatementLabel(memory, item.memoryId, 'stale')}
            </span>
            <span>{item.reasons.map(staleReasonLabel).join(' · ')}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function UnknownItem({
  item,
  onUnknownClick,
}: {
  readonly item: ResumeUnknown;
  readonly onUnknownClick?: (unknown: ResumeUnknown) => void;
}) {
  const content = (
    <>
      <span className="career-resume-unknown-mark">
        {item.blocking ? 'блокирует' : 'уточнить'}
      </span>
      <span>{item.message}</span>
      <span className="career-resume-unknown-group">
        {unknownGroupLabel(item.code)}
      </span>
    </>
  );

  return (
    <li
      key={`${item.code}-${item.entryId ?? ''}-${item.memoryId ?? ''}`}
      className={item.blocking ? 'is-blocking' : ''}
    >
      {onUnknownClick ? (
        <button
          type="button"
          className="career-resume-unknown-button"
          onClick={() => onUnknownClick(item)}
        >
          {content}
        </button>
      ) : (
        content
      )}
    </li>
  );
}

function UnknownsBlock({
  unknowns,
  onUnknownClick,
}: {
  readonly unknowns: readonly ResumeUnknown[];
  readonly onUnknownClick?: (unknown: ResumeUnknown) => void;
}) {
  return (
    <section className="career-resume-rail-block">
      <h3>Уточнить ({unknowns.length})</h3>
      {unknowns.length === 0 ? (
        <p className="career-resume-rail-ok">
          <CheckCircle size={16} /> Открытых пробелов нет.
        </p>
      ) : (
        <ul className="career-resume-unknowns">
          {unknowns.map((item) => (
            <UnknownItem
              key={`${item.code}-${item.entryId ?? ''}-${item.memoryId ?? ''}`}
              item={item}
              onUnknownClick={onUnknownClick}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ExcludedBlock({
  memoryIds,
  memory,
}: {
  memoryIds: readonly string[];
  memory: readonly CandidateMemory[];
}) {
  if (memoryIds.length === 0) return null;
  return (
    <section className="career-resume-rail-block">
      <h3>Не попало в документ ({memoryIds.length})</h3>
      <p>
        Эти записи не подтверждены как факт, помечены чувствительными или не
        имеют источника, поэтому движок их не проецирует.
      </p>
      <ul className="career-resume-excluded">
        {memoryIds.map((memoryId) => (
          <li key={memoryId}>
            <span className="career-resume-evidence-line">
              {evidenceStatementLabel(memory, memoryId, 'excluded')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ConventionsBlock({ conventions }: { conventions: ResumeConventions }) {
  return (
    <section className="career-resume-rail-block">
      <h3>
        <Info size={15} /> Правила варианта
      </h3>
      <ul className="career-resume-conventions">
        {conventionLines(conventions).map((line) => (
          <li key={line}>{line}</li>
        ))}
        {conventions.packVersion ? (
          <li>
            Набор конвенций <code>{conventions.packVersion}</code>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
