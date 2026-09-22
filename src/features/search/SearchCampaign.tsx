import { ArrowRight, EyeSlash } from '@phosphor-icons/react';
import { vacancyCoverage } from '../vacancies/vacancyFilters';
import { openTargetLabel } from '../vacancies/vacancyOpenTarget';
import { useEffect, useMemo, useState } from 'react';
import type { CareerStrategy } from '../../../shared/careerStrategy';
import { campaignRoleLine } from '../cabinet/careerStrategyView';
import { StrategyReviewPanel } from './StrategyReviewPanel';
import type { CareerCommand } from '../coach/coachApi';
import {
  getCareerCommands,
  getMatchedVacancyPage,
  getVacancyApplications,
} from '../coach/coachApi';
import type { VacancyApplication } from '../../../shared/vacancyApplication';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { collectMatchedPool, withDeadline } from '../vacancies/vacancyRead';
import { CareerRoutePremisesEditor } from '../cabinet/CareerRoutePremisesEditor';
import { CareerRoutePremises } from './RoutePremises';
import type { RoutePremisesDraft } from '../cabinet/routePremises';
import { CURRENT_PLAN } from '../shell/tariffPackages';
import {
  buildSearchCampaign,
  type CampaignTile,
  type SearchCampaign as SearchCampaignView,
} from './campaignModel';

/**
 * «Поиск» — кампания из макета «Пульт»: плитки, воронка, очередь на сегодня,
 * автоматизация по тарифу и раздел интервью.
 *
 * Всё, что продукт измеряет, стоит числом; всё, чего он не измеряет, названо
 * словами «не отслеживается». Пустых нулей на месте неизмеренного нет — это
 * то же правило, что запрещает кольцо «68 из 100» без знаменателя (B179).
 */
// Экран кампании — один связный блок: шапка, редактор предпосылок и плитки
// читаются вместе, а разнесение их по файлам только прячет порядок.
// eslint-disable-next-line max-lines-per-function
export function SearchCampaign({
  targetDirection,
  strategy = null,
  premises,
  premisesLoading,
  onSavePremises,
  onOpenVacancies,
  onOpenTariffs,
}: {
  readonly targetDirection: string;
  /**
   * Выбранная роль: кампания идёт по ней, а не по свободной строке анкеты
   * (B180, срез 2). `null` — роль ещё не выбрана, и это честно сказано.
   */
  readonly strategy?: CareerStrategy | null;
  readonly premises: RoutePremisesDraft;
  /** Пока предпосылки читаются, редактор не открывается: он показал бы пустые
      поля поверх сохранённых ответов и записал бы эту пустоту обратно. */
  readonly premisesLoading: boolean;
  readonly onSavePremises: (draft: RoutePremisesDraft) => Promise<void>;
  readonly onOpenVacancies: () => void;
  readonly onOpenTariffs: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const { pool, commands, applications, loading, failed } = useCampaignData();
  // Момент берётся один раз на прочитанный пул: пересчёт на каждый рендер
  // сдвигал бы «новых сегодня» под курсором.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date().toISOString(), [pool.length]);
  const campaign = useMemo(
    () => buildSearchCampaign({ pool, commands, applications, now }),
    [pool, commands, applications, now],
  );

  return (
    <section className="career-campaign" aria-labelledby="career-campaign-title">
      <header className="career-campaign-head">
        <div>
          <h2 id="career-campaign-title">
            {strategy
              ? `Кампания: «${strategy.current.role.title}»`
              : targetDirection.trim()
                ? `Кампания: «${targetDirection.trim()}»`
                : 'Кампания: роль не выбрана'}
          </h2>
          <p>{campaignRoleLine(strategy, targetDirection)}</p>
        </div>
        <button
          type="button"
          className="career-quiet-button"
          disabled={premisesLoading}
          onClick={() => setEditing((open) => !open)}
        >
          {premisesLoading ? 'Читаем текущие ответы…' : 'Роль, регион, формат'}
        </button>
      </header>

      {editing ? (
        <CareerRoutePremisesEditor
          initial={premises}
          saving={saving}
          error={saveError}
          onCancel={() => setEditing(false)}
          onSave={(draft) => {
            setSaving(true);
            setSaveError(undefined);
            void onSavePremises(draft)
              .then(() => setEditing(false))
              .catch((reason: unknown) =>
                setSaveError(reason instanceof Error ? reason.message : 'Не удалось сохранить.'),
              )
              .finally(() => setSaving(false));
          }}
        />
      ) : (
        <CareerRoutePremises
          targetRole={premises.targetRole}
          regions={premises.regions}
          workMode={premises.workMode ?? undefined}
          editDisabled={premisesLoading}
          onEdit={() => setEditing(true)}
        />
      )}

      {failed ? (
        <p className="career-cabinet-error" role="alert">
          Не удалось загрузить вакансии, счётчики скрыты — это сбой загрузки, а не пустая кампания.
        </p>
      ) : null}

      <div className="career-campaign-tiles">
        {campaign.tiles.map((tile) => (
          <TileCard key={tile.id} tile={tile} loading={loading} />
        ))}
        <div className="career-campaign-tile">
          <span className="career-cabinet-tag">Собрано по дням, 14 дней</span>
          <ActivityChart activity={campaign.activity} />
        </div>
      </div>

      <div className="career-campaign-body">
        <div className="career-campaign-column">
          {/* Ведущая вещь Поиска — очередь на сегодня; воронка объясняет её,
              а не предваряет (B233). */}
          <QueuePanel campaign={campaign} loading={loading} onOpenVacancies={onOpenVacancies} />
          <FunnelPanel campaign={campaign} />
        </div>
        <div className="career-campaign-column">
          {/* Сигналы пересмотра стратегии стоят рядом с воронкой, по которой
              они считаются (B180, срез 4). */}
          <StrategyReviewPanel strategy={strategy} pool={pool} commands={commands} now={now} />
          <AutomationPanel onOpenTariffs={onOpenTariffs} />
        </div>
      </div>
    </section>
  );
}

function FunnelPanel({ campaign }: { campaign: SearchCampaignView }) {
  return (
    <section className="career-home-panel">
        <header>
        <h3>Воронка</h3>
        <span className="career-cabinet-tag">первые три ступени — по вашим действиям здесь</span>
      </header>
      <ol className="career-funnel">
        {campaign.funnel.map((step) => (
          <li key={step.label} className={step.value === undefined ? 'is-untracked' : ''}>
            <span className="career-funnel-value">
              {step.value === undefined ? <EyeSlash size={16} aria-hidden="true" /> : step.value}
            </span>
            <span className="career-funnel-label">
              {step.label}
            </span>
            {step.value === undefined ? (
              <small className="career-funnel-untracked-label">не отслеживаем</small>
            ) : null}
          </li>
        ))}
      </ol>
      <p className="career-cabinet-tag">
        Дальше отклик живёт на площадке и в почте работодателя — они нам этого не сообщают,
        поэтому просмотры, ответы и интервью не считаем и нулём не показываем.
      </p>
    </section>
  );
}

function QueuePanel({
  campaign,
  loading,
  onOpenVacancies,
}: {
  campaign: SearchCampaignView;
  loading: boolean;
  onOpenVacancies: () => void;
}) {
  return (
    <section className="career-home-panel">
      <header>
        <h3>Очередь на сегодня</h3>
        <span className="career-cabinet-tag">
          {loading ? 'загружаем…' : `${campaign.poolTotal} подходящих`}
        </span>
      </header>
      {campaign.queue.length === 0 ? (
        <p className="career-home-empty">
          {loading
            ? 'Загружаем вакансии…'
            : 'Подходящих вакансий пока нет. Проверьте роль и условия или дождитесь следующего сбора.'}
        </p>
      ) : (
        <ol className="career-job-list">
          {campaign.queue.map((entry) => (
            <QueueRow key={entry.cluster.id} entry={entry} />
          ))}
        </ol>
      )}
      <button type="button" className="career-quiet-button" onClick={onOpenVacancies}>
        Открыть все вакансии <ArrowRight size={16} aria-hidden="true" />
      </button>
    </section>
  );
}

function TileCard({ tile, loading }: { tile: CampaignTile; loading: boolean }) {
  return (
    <div className="career-campaign-tile">
      <span className="career-cabinet-tag">{tile.label}</span>
      <strong className={tile.value === undefined ? 'is-untracked' : ''}>
        {tile.value === undefined ? '—' : loading && tile.id === 'fresh' ? '…' : tile.value}
      </strong>
      {tile.note ? <small>{tile.note}</small> : null}
    </div>
  );
}

/** Столбики по дням: сглаженная кривая соврала бы о днях без сбора. */
function ActivityChart({ activity }: { activity: readonly number[] }) {
  const peak = Math.max(1, ...activity);
  return (
    <ol
      className="career-activity-chart"
      role="img"
      aria-label={`Собрано вакансий по дням за две недели, максимум ${peak} за день`}
    >
      {activity.map((count, index) => (
        <li key={index}>
          <span data-share={String(Math.round((count / peak) * 10) * 10)} />
        </li>
      ))}
    </ol>
  );
}

function QueueRow({ entry }: { entry: MatchedVacancyItem }) {
  const coverage = vacancyCoverage(entry.explanation);
  return (
    <li className="career-job-card is-plain">
      <div className="career-job-head">
        <div className="career-job-title">
          <strong>{entry.cluster.canonicalTitle}</strong>
          <span className="career-job-meta">
            {entry.cluster.canonicalCompany || 'Работодатель не указан'} ·{' '}
            {entry.cluster.canonicalLocation ||
              (entry.cluster.isRemote ? 'Удалённо' : 'Локация не указана')}
          </span>
        </div>
        <span className="career-cabinet-tag">
          {coverage
            ? `совпало ${coverage.covered} из ${coverage.total} требований`
            : 'требования не выделены'}
        </span>
        <a
          className="career-quiet-button"
          href={entry.cluster.primaryUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          Открыть на {openTargetLabel(entry.cluster.sources)}
        </a>
      </div>
    </li>
  );
}

/** Что уже работает и что стоит денег — по тем же планам, что в «Тарифах». */
function AutomationPanel({ onOpenTariffs }: { onOpenTariffs: () => void }) {
  return (
    <section className="career-home-panel career-automation-panel">
      <header>
        <h3>Автоматизация</h3>
        <span className="career-pill is-muted">план «{CURRENT_PLAN.name}»</span>
      </header>
      <p className="career-cabinet-tag">
        Текущий план: «{CURRENT_PLAN.name}». Платные тарифы пока не продаются.
      </p>
      <button type="button" className="career-quiet-button" onClick={onOpenTariffs}>
        Посмотреть тарифы <ArrowRight size={15} aria-hidden="true" />
      </button>
    </section>
  );
}

function useCampaignData() {
  const [pool, setPool] = useState<MatchedVacancyItem[]>([]);
  const [commands, setCommands] = useState<CareerCommand[]>([]);
  const [applications, setApplications] = useState<VacancyApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void collectMatchedPool<MatchedVacancyItem>(
      (offset) => withDeadline((signal) => getMatchedVacancyPage(offset, signal)),
      undefined,
      (items) => {
        if (!active) return;
        setPool((read) => [...read, ...items]);
        setLoading(false);
      },
    ).catch(() => {
      if (active) setFailed(true);
    });

    void getCareerCommands()
      .then((list) => {
        if (active) setCommands(list);
      })
      // Команд может не быть вовсе — это не ошибка кампании.
      .catch(() => undefined);

    void getVacancyApplications()
      .then((list) => {
        if (active) setApplications(list);
      })
      // Откликов может не быть вовсе — это тоже не ошибка кампании.
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  return { pool, commands, applications, loading, failed };
}
