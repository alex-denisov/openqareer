import { useState } from 'react';
import {
  ArrowRight,
  ArrowSquareOut,
  Check,
  CircleNotch,
  MapPin,
} from '@phosphor-icons/react';
import {
  completeCandidateAnalysis,
  createCandidateAnalysis,
} from '../../evidence/evidenceEngine';
import type {
  CandidateWorkspace,
} from '../../workspace/workspaceStorage';
import {
  type CareerJourney,
} from '../careerJourneyEngine';

import { fetchHhMarketSample } from '../marketApi';
import { JourneyViewProps, RoleState, ViewHeader } from './_shared';
export function CareerMapView({
  workspace,
  journey,
  onNavigate,
  onOpenExpert,
  onUpdateWorkspace,
}: JourneyViewProps) {
  const [target, setTarget] = useState(workspace.targetDirection);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState<string>();

  function saveTarget() {
    const clean = target.trim();
    if (clean.length < 2) return;
    const analysisBase = workspace.analysis ?? createCandidateAnalysis(
      workspace.resumeText || workspace.currentSituation,
    );
    onUpdateWorkspace({
      ...workspace,
      targetDirection: clean,
      analysis: completeCandidateAnalysis(clean, analysisBase),
      updatedAt: new Date().toISOString(),
    });
  }

  async function collectMarketSample() {
    const query = workspace.targetDirection.trim();
    if (query.length < 2 || marketLoading) return;
    setMarketLoading(true);
    setMarketError(undefined);
    try {
      const marketSample = await fetchHhMarketSample(query);
      onUpdateWorkspace({
        ...workspace,
        marketSample,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      setMarketError(
        'hh.ru не вернул выборку. Можно повторить позже или добавить вакансию вручную.',
      );
    } finally {
      setMarketLoading(false);
    }
  }

  return (
    <div className="career-view career-map-view">
      <ViewHeader
        eyebrow="Роли, рынок и путь"
        title="Карьера"
        action="Обсудить решение"
        onAction={onOpenExpert}
      />

      {!workspace.targetDirection.trim() ? (
        <section className="career-role-question">
          <div>
            <p className="career-eyebrow">Рабочая гипотеза</p>
            <h2>Как назвать направление для первой проверки?</h2>
            <p>
              Это не окончательный выбор. Название нужно, чтобы сопоставить ваш
              опыт с реальными задачами и вакансиями.
            </p>
          </div>
          <label>
            <span>Роль или группа задач</span>
            <input
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder="Например: операционное управление"
            />
          </label>
          <button
            className="career-primary-button"
            type="button"
            disabled={target.trim().length < 2}
            onClick={saveTarget}
          >
            Проверить гипотезу
            <ArrowRight size={17} />
          </button>
        </section>
      ) : null}

      {journey.roles.length ? (
        <section className="career-role-comparison" aria-labelledby="roles-title">
          <div className="career-section-heading">
            <div>
              <p className="career-eyebrow">Не рейтинг</p>
              <h2 id="roles-title">Гипотезы для проверки</h2>
            </div>
            <span>{journey.roles.length} направления</span>
          </div>
          <div className="career-role-table" role="list">
            {journey.roles.map((role, index) => (
              <article key={role.id} role="listitem" className="career-role-row">
                <span className="career-role-index">0{index + 1}</span>
                <div className="career-role-name">
                  <strong>{role.title}</strong>
                  <small>{role.basis}</small>
                </div>
                <div>
                  <span>Опора</span>
                  <strong>{role.evidenceCount} подтверждено</strong>
                </div>
                <div>
                  <span>Проверить</span>
                  <strong>{role.gaps[0] ?? 'Свежую рыночную выборку'}</strong>
                </div>
                <RoleState state={role.fitState} />
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="career-market-routes" aria-labelledby="market-title">
        <div className="career-section-heading">
          <div>
            <p className="career-eyebrow">География и формат</p>
            <h2 id="market-title">Маршруты рынка</h2>
          </div>
        </div>
        {journey.markets.map((market) => (
          <article key={market.id}>
            <MapPin size={21} />
            <div>
              <strong>{market.label}</strong>
              <p>{market.explanation}</p>
            </div>
            <span
              className={`career-market-state ${market.state === 'sample-ready' ? 'is-ready' : ''}`}
            >
              {market.state === 'sample-ready' ? 'Свежая выборка' : 'Нужна выборка'}
            </span>
          </article>
        ))}
        {workspace.market === 'ru' && !workspace.marketSample ? (
          <button
            className="career-primary-button career-market-collect"
            type="button"
            disabled={workspace.targetDirection.trim().length < 2 || marketLoading}
            onClick={collectMarketSample}
          >
            {marketLoading ? 'Собираем hh.ru…' : 'Собрать выборку hh.ru'}
            <ArrowRight size={17} />
          </button>
        ) : null}
        {workspace.market === 'international' ? (
          <button
            className="career-quiet-button career-market-collect"
            type="button"
            onClick={() => onNavigate('opportunities')}
          >
            Добавить международную вакансию
            <ArrowRight size={17} />
          </button>
        ) : null}
        {marketError ? (
          <p className="career-market-error" role="alert">{marketError}</p>
        ) : null}
      </section>

      {workspace.marketSample ? (
        <MarketSampleView
          sample={workspace.marketSample}
          fresh={journey.markets[0]?.state === 'sample-ready'}
          loading={marketLoading}
          onRefresh={collectMarketSample}
        />
      ) : null}

      <CareerTrack journey={journey} />
    </div>
  );
}

function MarketSampleView({
  sample,
  fresh,
  loading,
  onRefresh,
}: {
  sample: NonNullable<CandidateWorkspace['marketSample']>;
  fresh: boolean;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <section className="career-market-sample" aria-labelledby="market-sample-title">
      <div className="career-section-heading">
        <div>
          <p className="career-eyebrow">
            hh.ru · наблюдение от {formatObservedAt(sample.fetchedAt)}
          </p>
          <h2 id="market-sample-title">
            {fresh ? 'Свежие вакансии по гипотезе' : 'Выборка устарела'}
          </h2>
        </div>
        <div className="career-market-sample-actions">
          <span>{sample.items.length} из {sample.found}</span>
          <button type="button" disabled={loading} onClick={onRefresh}>
            {loading ? 'Обновляем…' : 'Обновить'}
          </button>
        </div>
      </div>
      <div className="career-market-vacancies">
        {sample.items.slice(0, 6).map((item) => (
          <a
            key={item.id}
            href={item.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            <span>
              <strong>{item.title}</strong>
              <small>{item.company} · {item.location}</small>
            </span>
            <span>
              <small>{formatSalary(item.salary)}</small>
              <ArrowSquareOut size={17} />
            </span>
          </a>
        ))}
      </div>
      <p className="career-market-caveat">
        Это наблюдение одного источника, а не весь рынок. Повторяющиеся требования
        нужно сравнить с профилем и другими площадками.
      </p>
    </section>
  );
}

function formatObservedAt(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatSalary(
  salary: NonNullable<CandidateWorkspace['marketSample']>['items'][number]['salary'],
): string {
  if (!salary) return 'Доход не указан';
  const formatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  const range = salary.from && salary.to
    ? `${formatter.format(salary.from)}–${formatter.format(salary.to)}`
    : salary.from
      ? `от ${formatter.format(salary.from)}`
      : salary.to
        ? `до ${formatter.format(salary.to)}`
        : 'Диапазон не указан';
  return `${range} ${salary.currency}${salary.gross ? ' до налогов' : ''}`;
}

function CareerTrack({ journey }: { journey: CareerJourney }) {
  return (
    <section className="career-track" aria-labelledby="track-title">
      <div className="career-section-heading">
        <div>
          <p className="career-eyebrow">Можно пересматривать</p>
          <h2 id="track-title">Карьерный трек</h2>
        </div>
      </div>
      <ol>
        {journey.track.map((item) => (
          <li key={item.id} className={`is-${item.status}`}>
            <span className="career-track-marker">
              {item.status === 'complete' ? (
                <Check size={16} weight="bold" />
              ) : item.status === 'active' ? (
                <CircleNotch size={17} weight="bold" />
              ) : null}
            </span>
            <div>
              <strong>{item.label}</strong>
              <p>{item.reason}</p>
            </div>
            <small>
              {item.status === 'complete'
                ? 'Собрано'
                : item.status === 'active'
                  ? 'Сейчас'
                  : 'После предыдущего решения'}
            </small>
          </li>
        ))}
      </ol>
    </section>
  );
}

