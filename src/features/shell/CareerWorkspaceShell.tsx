import { useState } from 'react';
import {
  ArrowRight,
  Briefcase,
  ChatCircleDots,
  Check,
  House,
  MagnifyingGlass,
  MapTrifold,
  Path,
  Sparkle,
  UserCircle,
  Wallet,
  type Icon,
} from '@phosphor-icons/react';
import {
  buildCareerDiagnostic,
  type DiagnosticFinding,
} from '../diagnostic/careerDiagnostic';
import {
  buildRoleMarketMap,
  type RequestedMarket,
  type RoleMarketMap,
  type WorkMode,
} from '../career-map/roleMarketMap';
import {
  buildReasonedCareerAction,
  type ReasonedCareerAction,
} from '../next-action/careerActionPolicy';
import type { CandidateWorkspace } from '../workspace/workspaceStorage';
import { CareerTariffsView } from './CareerTariffsView';

type ShellView = 'today' | 'profile' | 'career' | 'search' | 'plans';

interface CareerWorkspaceShellProps {
  workspace: CandidateWorkspace;
  onOpenCoach: () => void;
  onOpenEvidence: () => void;
  onOpenOpportunity: () => void;
  onOpenActionPackage: () => void;
  onOpenOutcome: () => void;
  onEdit: () => void;
}

const navItems: Array<{ id: Exclude<ShellView, 'plans'>; label: string; icon: Icon }> = [
  { id: 'today', label: 'Сегодня', icon: House },
  { id: 'profile', label: 'Профиль', icon: UserCircle },
  { id: 'career', label: 'Карьера', icon: Path },
  { id: 'search', label: 'Поиск', icon: MagnifyingGlass },
];

const pageTitles: Record<ShellView, string> = {
  today: 'Сегодня',
  profile: 'Профиль',
  career: 'Карьера',
  search: 'Поиск',
  plans: 'Тарифы',
};

export function CareerWorkspaceShell({
  workspace,
  onOpenCoach,
  onOpenEvidence,
  onOpenOpportunity,
  onOpenActionPackage,
  onOpenOutcome,
  onEdit,
}: CareerWorkspaceShellProps) {
  const [activeView, setActiveView] = useState<ShellView>('today');
  const diagnostic = buildCareerDiagnostic({
    resumeText: workspace.resumeText,
    resumeSource: workspace.resumeSource,
    sourceUpdatedAt: null,
    targetDirection: workspace.targetDirection,
    analysis: workspace.analysis,
    marketEvidenceUpdatedAt: null,
  });
  const roleMarketMap = buildRoleMarketMap({
    roleHypotheses: workspace.analysis?.roleHypotheses ?? [],
    evidence: workspace.analysis?.evidenceItems ?? [],
    markets: requestedMarketsFor(workspace),
  });
  const reasonedAction = buildReasonedCareerAction({
    diagnostic,
    roleMarketMap,
    constraints: workspace.constraints,
  });
  const navigate = (view: ShellView) => setActiveView(view);

  return (
    <div className="career-shell" data-testid="career-shell">
      <a className="career-skip-link" href="#career-main">
        К содержанию
      </a>
      <aside className="career-rail" aria-label="Основная навигация">
        <button
          className="career-brand-mark"
          type="button"
          onClick={() => navigate('today')}
          aria-label="openqareer, сегодня"
        >
          <MapTrifold size={25} weight="duotone" aria-hidden="true" />
        </button>
        <nav>
          {navItems.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={activeView === item.id}
              onClick={() => navigate(item.id)}
            />
          ))}
        </nav>
        <div className="career-rail-bottom">
          <NavButton
            item={{ id: 'plans', label: 'Тарифы', icon: Wallet }}
            active={activeView === 'plans'}
            onClick={() => navigate('plans')}
          />
          <button
            className="career-avatar-button"
            type="button"
            onClick={() => navigate('profile')}
            aria-label="Открыть профиль"
            title="Профиль"
          >
            {workspace.targetDirection.slice(0, 1).toUpperCase() || 'О'}
          </button>
        </div>
      </aside>

      <header className="career-topbar">
        <button
          className="career-wordmark"
          type="button"
          onClick={() => navigate('today')}
        >
          <span>open</span>qareer
        </button>
        <span className="career-page-name">{pageTitles[activeView]}</span>
        <div className="career-topbar-actions">
          <button
            className="career-search-button"
            type="button"
            onClick={() => navigate('search')}
          >
            <MagnifyingGlass size={19} aria-hidden="true" />
            <span>Поиск</span>
          </button>
          <button
            className="career-expert-trigger"
            type="button"
            onClick={onOpenCoach}
            data-testid="open-career-expert"
          >
            <Sparkle size={18} weight="fill" aria-hidden="true" />
            Эксперт
          </button>
        </div>
      </header>

      <main id="career-main" className="career-main">
        {activeView === 'today' ? (
          <TodayView
            diagnostic={diagnostic}
            reasonedAction={reasonedAction}
            workspace={workspace}
            navigate={navigate}
            onOpenCoach={onOpenCoach}
            onOpenEvidence={onOpenEvidence}
          />
        ) : null}
        {activeView === 'profile' ? (
          <ProfileView
            diagnostic={diagnostic}
            workspace={workspace}
            onOpenCoach={onOpenCoach}
            onOpenEvidence={onOpenEvidence}
            onEdit={onEdit}
          />
        ) : null}
        {activeView === 'career' ? (
          <CareerView
            marketMap={roleMarketMap}
            onOpenCoach={onOpenCoach}
            onOpenEvidence={onOpenEvidence}
            onContinue={() => navigate('search')}
          />
        ) : null}
        {activeView === 'search' ? (
          <SearchView
            workspace={workspace}
            onOpenCoach={onOpenCoach}
            onOpenOpportunity={onOpenOpportunity}
            onOpenActionPackage={onOpenActionPackage}
            onOpenOutcome={onOpenOutcome}
            onOpenCareer={() => navigate('career')}
            onOpenPlans={() => navigate('plans')}
          />
        ) : null}
        {activeView === 'plans' ? (
          <CareerTariffsView onOpenCoach={onOpenCoach} />
        ) : null}
      </main>
    </div>
  );
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: { id: ShellView; label: string; icon: Icon };
  active: boolean;
  onClick: () => void;
}) {
  const ItemIcon = item.icon;
  return (
    <button
      className={`career-nav-button ${active ? 'is-active' : ''}`}
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-label={item.label}
      title={item.label}
    >
      <ItemIcon
        size={22}
        weight={active ? 'fill' : 'regular'}
        aria-hidden="true"
      />
      <span>{item.label}</span>
    </button>
  );
}

function TodayView({
  diagnostic,
  reasonedAction,
  workspace,
  navigate,
  onOpenCoach,
  onOpenEvidence,
}: {
  diagnostic: ReturnType<typeof buildCareerDiagnostic>;
  reasonedAction: ReasonedCareerAction;
  workspace: CandidateWorkspace;
  navigate: (view: ShellView) => void;
  onOpenCoach: () => void;
  onOpenEvidence: () => void;
}) {
  const roleCount = workspace.analysis?.roleHypotheses.length ?? 0;
  const searchState = workspace.outcomes.length
    ? 'Есть результаты'
    : workspace.opportunity
      ? '1 вакансия'
      : 'Не запущен';
  const runDestination = (destination: ReasonedCareerAction['destination']) => {
    if (destination === 'coach') return onOpenCoach();
    if (destination === 'evidence') return onOpenEvidence();
    if (destination === 'career') return navigate('career');
    if (destination === 'search') return navigate('search');
    return navigate('profile');
  };
  return (
    <div className="career-view career-today-view">
      <section className="career-decision-stage" aria-labelledby="today-title">
        <p className="career-eyebrow">Следующее действие</p>
        <h1 id="today-title">{reasonedAction.headline}</h1>
        <p className="career-lead">{reasonedAction.rationale}</p>
        <div className="career-primary-actions">
          <button
            className="career-primary-button"
            type="button"
            onClick={() => runDestination(reasonedAction.destination)}
            data-testid="next-career-action"
          >
            {reasonedAction.label}
            <ArrowRight size={18} weight="bold" aria-hidden="true" />
          </button>
          <button
            className="career-quiet-button"
            type="button"
            onClick={onOpenCoach}
          >
            <ChatCircleDots size={18} aria-hidden="true" />
            Спросить эксперта
          </button>
        </div>
        <details className="career-action-explanation">
          <summary>Почему именно сейчас</summary>
          <p>{reasonedAction.expectedChange}</p>
          <div>
            {reasonedAction.alternatives.map((alternative) => (
              <button
                key={alternative.id}
                type="button"
                onClick={() => runDestination(alternative.destination)}
              >
                {alternative.label}
              </button>
            ))}
          </div>
          <small>{reasonedAction.approvalBoundary}</small>
        </details>
      </section>

      <section className="career-progress-line" aria-label="Состояние поиска">
        <StatLink
          label="Профиль"
          value={diagnostic.coverage.isPartial ? 'Нужно уточнить' : 'Готов'}
          onClick={() => navigate('profile')}
        />
        <StatLink
          label="Карьера"
          value={roleCount ? `${roleCount} гипотезы` : 'Не выбрана'}
          onClick={() => navigate('career')}
        />
        <StatLink
          label="Поиск"
          value={searchState}
          onClick={() => navigate('search')}
        />
      </section>

      <section className="career-autopilot-nudge" aria-label="Платная автоматизация">
        <div className="career-nudge-mark">
          <Sparkle size={20} weight="fill" aria-hidden="true" />
        </div>
        <div>
          <strong>Рутину можно передать openqareer</strong>
          <span>Сначала бесплатная диагностика и решение, затем — ограниченный объём исполнения.</span>
        </div>
        <button type="button" onClick={() => navigate('plans')}>
          Посмотреть тарифы
        </button>
      </section>
    </div>
  );
}

function StatLink({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button className="career-stat-link" type="button" onClick={onClick}>
      <span>{label}</span>
      <strong>{value}</strong>
      <ArrowRight size={16} aria-hidden="true" />
    </button>
  );
}

function ProfileView({
  diagnostic,
  workspace,
  onOpenCoach,
  onOpenEvidence,
  onEdit,
}: {
  diagnostic: ReturnType<typeof buildCareerDiagnostic>;
  workspace: CandidateWorkspace;
  onOpenCoach: () => void;
  onOpenEvidence: () => void;
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(
    diagnostic.nextAction.findingIds[0] ??
      diagnostic.findings.find((item) => item.status === 'issue')?.id ??
      diagnostic.findings[0]?.id ??
      null,
  );
  return (
    <div className="career-view career-simple-view">
      <ViewHeading
        eyebrow="Бесплатная диагностика"
        title="Профиль"
        action="Проверить с экспертом"
        onAction={onOpenCoach}
      />
      <div className="career-profile-summary">
        <div className="career-profile-avatar">
          {workspace.targetDirection.slice(0, 1).toUpperCase() || 'О'}
        </div>
        <div>
          <strong>{workspace.targetDirection}</strong>
          <span>{sourceLabel(workspace)} · данные хранятся локально</span>
        </div>
        <button className="career-text-button" type="button" onClick={onEdit}>
          Изменить
        </button>
      </div>

      <p className="career-diagnostic-summary">{diagnostic.summary}</p>
      <section className="career-detail-list" aria-label="Результаты диагностики">
        {diagnostic.findings.map((finding) => (
          <DiagnosticRow
            key={finding.id}
            finding={finding}
            open={expanded === finding.id}
            onToggle={() =>
              setExpanded(expanded === finding.id ? null : finding.id)
            }
          />
        ))}
      </section>
      <div className="career-section-action">
        <span>Каждый вывод можно проверить и исправить.</span>
        <button className="career-primary-button" type="button" onClick={onOpenEvidence}>
          Проверить факты
          <ArrowRight size={18} weight="bold" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function DiagnosticRow({
  finding,
  open,
  onToggle,
}: {
  finding: DiagnosticFinding;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`career-detail-row ${open ? 'is-open' : ''}`}>
      <button type="button" onClick={onToggle} aria-expanded={open}>
        <span>{dimensionLabel(finding.dimension)}</span>
        <strong>{finding.title}</strong>
        <span className={`career-finding-state is-${finding.status}`}>
          {certaintyLabel(finding.certainty)}
        </span>
        <ArrowRight size={18} aria-hidden="true" />
      </button>
      {open ? (
        <div className="career-finding-detail">
          <p>{finding.explanation}</p>
          <span>{finding.correction}</span>
          {finding.sourceRefs.length ? (
            <small>Основание: {finding.sourceRefs.join(' · ')}</small>
          ) : (
            <small>Основание пока отсутствует</small>
          )}
        </div>
      ) : null}
    </div>
  );
}

function CareerView({
  marketMap,
  onOpenCoach,
  onOpenEvidence,
  onContinue,
}: {
  marketMap: RoleMarketMap;
  onOpenCoach: () => void;
  onOpenEvidence: () => void;
  onContinue: () => void;
}) {
  const [selected, setSelected] = useState(marketMap.roles[0]?.id ?? '');
  const [selectedMarket, setSelectedMarket] = useState(
    marketMap.markets[0]?.id ?? '',
  );
  return (
    <div className="career-view career-simple-view">
      <ViewHeading
        eyebrow="Карьерное решение"
        title="Куда двигаться"
        action="Обсудить"
        onAction={onOpenCoach}
      />
      {marketMap.roles.length === 0 ? (
        <EmptyState
          icon={Path}
          title="Сначала нужны подтверждённые факты"
          description="Роли появятся после проверки задач, результатов и масштаба ответственности."
          action="Проверить факты"
          onAction={onOpenEvidence}
        />
      ) : (
        <>
          <p className="career-route-prompt">
            Выберите рабочую гипотезу. Это решение можно изменить после проверки рынка.
          </p>
          <div className="career-route-list" aria-label="Гипотезы ролей">
            {marketMap.roles.map((role) => {
              const active = role.id === selected;
              return (
                <button
                  className={`career-route-row ${active ? 'is-selected' : ''}`}
                  key={role.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelected(role.id)}
                  data-testid={`role-hypothesis-${role.id}`}
                >
                  <span className="career-radio-mark">
                    {active ? <Check size={14} weight="bold" aria-hidden="true" /> : null}
                  </span>
                  <span className="career-route-name">
                    <strong>{role.title}</strong>
                    <small>{role.basis}</small>
                  </span>
                  <span className="career-route-fit">
                    {role.evidenceRefs.length} подтверждения
                  </span>
                  <span className="career-route-signal">
                    {role.fitState === 'plausible'
                      ? 'Сильнее'
                      : role.fitState === 'adjacent'
                        ? 'Смежная'
                        : 'Нужно проверить'}
                  </span>
                </button>
              );
            })}
          </div>
          <section className="career-market-section" aria-labelledby="market-title">
            <div>
              <p className="career-eyebrow">Рынки — отдельно</p>
              <h2 id="market-title">Где проверять роль</h2>
            </div>
            <div className="career-market-list">
              {marketMap.markets.map((market) => {
                const active = market.id === selectedMarket;
                return (
                  <button
                    key={market.id}
                    className={active ? 'is-selected' : ''}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSelectedMarket(market.id)}
                    data-testid={`market-route-${market.id}`}
                  >
                    <span>{market.label}</span>
                    <strong>{workModeLabel(market.workMode)}</strong>
                    <small>
                      {market.sampleStatus === 'fresh'
                        ? `${market.sampleSize} свежих вакансий`
                        : market.lastObservedAt
                          ? `Выборка устарела · ${market.sampleSize}`
                          : 'Нужна датированная выборка'}
                    </small>
                  </button>
                );
              })}
            </div>
          </section>
          <div className="career-section-action">
            <span>{marketMap.nextExperiment.reason}</span>
            <button className="career-primary-button" type="button" onClick={onContinue}>
              Проверить рынок
              <ArrowRight size={18} weight="bold" aria-hidden="true" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SearchView({
  workspace,
  onOpenCoach,
  onOpenOpportunity,
  onOpenActionPackage,
  onOpenOutcome,
  onOpenCareer,
  onOpenPlans,
}: {
  workspace: CandidateWorkspace;
  onOpenCoach: () => void;
  onOpenOpportunity: () => void;
  onOpenActionPackage: () => void;
  onOpenOutcome: () => void;
  onOpenCareer: () => void;
  onOpenPlans: () => void;
}) {
  const rolesReady = Boolean(workspace.analysis?.roleHypotheses.length);
  const action = workspace.outcomes.length
    ? { label: 'Открыть результаты', run: onOpenOutcome }
    : workspace.actionPackage
      ? { label: 'Открыть пакет действия', run: onOpenActionPackage }
      : workspace.opportunity
        ? { label: 'Продолжить разбор вакансии', run: onOpenOpportunity }
        : rolesReady
          ? { label: 'Добавить вакансию', run: onOpenOpportunity }
          : { label: 'Сначала выбрать роль', run: onOpenCareer };
  return (
    <div className="career-view career-simple-view">
      <ViewHeading
        eyebrow="Кампания"
        title="Поиск"
        action="Настроить со стратегом"
        onAction={onOpenCoach}
      />
      <EmptyState
        icon={Briefcase}
        title={
          workspace.opportunity
            ? 'Решение по вакансии сохранено'
            : 'Начните с одной реальной возможности'
        }
        description={
          workspace.opportunity
            ? 'Совпадения, пробелы и решение связаны с подтверждёнными фактами.'
            : 'P1 проверяет маршрут на одной вакансии. Массовая кампания включается только после проверки.'
        }
        action={action.label}
        onAction={action.run}
      />
      <section className="career-execution-offer">
        <span>
          <strong>Дальше openqareer сможет исполнить кампанию.</strong>{' '}
          Поиск, referral-first, отклики и контроль ответов идут отдельным ограниченным объёмом.
        </span>
        <button type="button" onClick={onOpenPlans}>Выбрать объём</button>
      </section>
    </div>
  );
}

function ViewHeading({
  eyebrow,
  title,
  action,
  onAction,
}: {
  eyebrow: string;
  title: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <header className="career-view-heading">
      <div>
        <p className="career-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      <button className="career-icon-text-button" type="button" onClick={onAction}>
        <ChatCircleDots size={18} aria-hidden="true" />
        {action}
      </button>
    </header>
  );
}

function EmptyState({
  icon: EmptyIcon,
  title,
  description,
  action,
  onAction,
}: {
  icon: Icon;
  title: string;
  description: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <section className="career-empty-state">
      <div className="career-empty-icon">
        <EmptyIcon size={28} aria-hidden="true" />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      <button className="career-primary-button" type="button" onClick={onAction}>
        {action}
        <ArrowRight size={18} weight="bold" aria-hidden="true" />
      </button>
    </section>
  );
}

function sourceLabel(workspace: CandidateWorkspace): string {
  return workspace.resumeFileName ??
    ({
      pdf: 'PDF-резюме',
      'linkedin-pdf': 'Экспорт LinkedIn',
      'hh-pdf': 'Экспорт hh.ru',
      text: 'Текстовый источник',
    } as const)[workspace.resumeSource];
}

function dimensionLabel(value: DiagnosticFinding['dimension']): string {
  return {
    readability: 'Читаемость',
    ats: 'ATS',
    evidence: 'Доказательства',
    freshness: 'Актуальность',
    contradictions: 'Согласованность',
    market: 'Рынок',
  }[value];
}

function certaintyLabel(value: DiagnosticFinding['certainty']): string {
  return {
    fact: 'Факт',
    hypothesis: 'Гипотеза',
    unknown: 'Неизвестно',
  }[value];
}

function requestedMarketsFor(workspace: CandidateWorkspace): RequestedMarket[] {
  const constraints = workspace.constraints.toLocaleLowerCase('ru');
  const markets: RequestedMarket[] = [];
  if (
    workspace.market === 'ru' ||
    /росси|(?:^|[^\p{L}])рф(?:$|[^\p{L}])/iu.test(constraints)
  ) {
    markets.push({
      id: 'russia',
      geography: 'russia',
      label: 'Россия',
      workMode: /удал[её]н|remote/iu.test(constraints) ? 'remote' : 'hybrid',
      observations: [],
    });
  }
  if (workspace.market === 'international') {
    const remoteOnly = /только\s+(?:удал[её]н|remote)|remote[- ]only/iu.test(
      constraints,
    );
    if (!remoteOnly) {
      const country = inferRelocationCountry(workspace.constraints);
      markets.push({
        id: `relocation-${country.code ?? 'unknown'}`,
        geography: 'relocation',
        label: country.label ? `Релокация: ${country.label}` : 'Релокация',
        countryCode: country.code,
        workMode: 'hybrid',
        observations: [],
      });
    }
    markets.push({
      id: 'worldwide-remote',
      geography: 'worldwide-remote',
      label: 'Удалённо по миру',
      workMode: 'remote',
      observations: [],
    });
  }
  return markets.slice(0, 3);
}

function inferRelocationCountry(value: string): { code?: string; label?: string } {
  if (/германи|germany|deutschland/iu.test(value)) {
    return { code: 'DE', label: 'Германия' };
  }
  if (/оаэ|эмират|\buae\b|emirates/iu.test(value)) {
    return { code: 'AE', label: 'ОАЭ' };
  }
  return {};
}

function workModeLabel(value: WorkMode): string {
  return {
    onsite: 'В офисе',
    hybrid: 'Гибрид / офис',
    remote: 'Удалённо',
  }[value];
}
