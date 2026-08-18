import { useMemo } from 'react';
import { ArrowRight, CheckCircle, Circle, Compass, TrendUp } from '@phosphor-icons/react';
import type { AccountSnapshot, AuthUser } from '../coach/coachApi';
import {
  buildCanonicalProfileJourney,
  type CareerJourney,
} from '../journey/careerJourneyEngine';
import type { CandidateWorkspace } from '../workspace/workspaceStorage';
import { CareerCoachDesk } from './CareerCoachDesk';
import { CareerIntelligencePanel } from './CareerIntelligencePanel';
import { CareerProfileSurface } from './CareerProfileSurface';
import { ResumeStudio } from '../resume/ResumeStudio';
import { AppErrorBoundary } from '../shell/AppErrorBoundary';
import { useCareerCabinetData } from './useCareerCabinetData';

export type CareerCabinetView =
  | 'today'
  | 'profile'
  | 'resume'
  | 'career'
  | 'opportunities';

interface CareerCabinetProps {
  view: CareerCabinetView;
  session: AuthUser & { candidateId: string };
  workspace?: CandidateWorkspace;
  journey?: CareerJourney;
  onNavigate: (view: CareerCabinetView) => void;
  onUpdateWorkspace: (workspace: CandidateWorkspace) => void;
  onOpenAccount: () => void;
}

export function CareerCabinet({
  view,
  session,
  workspace,
  journey,
  onNavigate,
  onUpdateWorkspace,
  onOpenAccount,
}: CareerCabinetProps) {
  const data = useCareerCabinetData(session.candidateId);
  const name = data.account?.displayName ?? session.displayName ?? session.username;
  const targetDirection =
    data.account?.profile.headline?.trim() || workspace?.targetDirection || '';
  const canonicalJourney = useMemo(
    () =>
      data.snapshot
        ? buildCanonicalProfileJourney(
            journey,
            data.snapshot.memory,
            targetDirection,
            undefined,
            workspace?.constraints ?? '',
          )
        : journey,
    [
      data.snapshot,
      journey,
      targetDirection,
      workspace?.constraints,
    ],
  );
  return (
    <AppErrorBoundary
      fallbackTitle="Не удалось отобразить кабинет"
      fallbackMessage="При отображении разделов кабинета произошла ошибка. Ваши сохранённые данные в безопасности."
      onReset={() => void data.refresh()}
    >
      <div className={`career-cabinet career-cabinet-view-${view}`}>
        <CabinetHeader view={view} name={name} data={data} />
        {data.error ? <p className="career-cabinet-global-error" role="alert">{data.error}</p> : null}
        <CabinetView {...{ view, session, workspace, onNavigate, onUpdateWorkspace, onOpenAccount, data }} journey={canonicalJourney} />
      </div>
    </AppErrorBoundary>
  );
}

type CabinetData = ReturnType<typeof useCareerCabinetData>;

function CabinetHeader({ view, name, data }: { view: CareerCabinetView; name: string; data: CabinetData }) {
  const description = view === 'today'
    ? `${firstName(name)}, здесь собраны разговор, профиль и реальные сигналы рынка.`
    : viewDescription(view);
  return (
    <header className="career-cabinet-header"><div>
      <span className="career-cabinet-kicker">{todayLabel()}</span><h1>{viewTitle(view)}</h1><p>{description}</p>
    </div><div className="career-cabinet-header-state">
      <span className={data.error ? 'is-error' : 'is-ready'}>
        {data.error ? <Circle size={14} weight="fill" /> : <CheckCircle size={16} />}
        {data.loading ? 'Обновляем' : data.error ? 'Нужна связь' : 'Данные актуальны'}
      </span>
      {data.error ? <button type="button" onClick={() => void data.refresh()}>Повторить</button> : null}
    </div></header>
  );
}

function CabinetView(props: CareerCabinetProps & { data: CabinetData }) {
  if (props.view === 'today') return <TodayView {...props} />;
  if (props.view === 'profile') return <ProfileView {...props} />;
  if (props.view === 'resume') return <ResumeView {...props} />;
  if (props.view === 'career') return <TrackView {...props} />;
  return <MarketView {...props} />;
}

function TodayView(props: CareerCabinetProps & { data: CabinetData }) {
  const shared = cabinetPanelProps(props);
  return (
    <div className="career-command-center">
      <CareerCoachDesk {...shared.coach} />
      <CareerProfileSurface {...shared.profile} />
      <CareerIntelligencePanel {...shared.market} />
    </div>
  );
}

function ProfileView(props: CareerCabinetProps & { data: CabinetData }) {
  const shared = cabinetPanelProps(props);
  return <div className="career-cabinet-focus-layout"><CareerProfileSurface {...shared.profile} expanded /><CareerIntelligencePanel {...shared.market} /></div>;
}

function ResumeView(props: CareerCabinetProps & { data: CabinetData }) {
  return (
    <ResumeStudio
      memory={props.data.snapshot?.memory ?? []}
      onRefreshDossier={() => void props.data.refresh()}
    />
  );
}

function TrackView(props: CareerCabinetProps & { data: CabinetData }) {
  const shared = cabinetPanelProps(props);
  return <div className="career-cabinet-focus-layout is-track"><CareerTrackBoard journey={props.journey} snapshot={props.data.snapshot} account={props.data.account} targetDirection={shared.targetDirection} onNavigate={props.onNavigate} onEditPremises={props.onOpenAccount} /><CareerCoachDesk {...shared.coach} /></div>;
}

function MarketView(props: CareerCabinetProps & { data: CabinetData }) {
  const shared = cabinetPanelProps(props);
  return <div className="career-cabinet-focus-layout is-market"><CareerIntelligencePanel {...shared.market} expanded /><CareerCoachDesk {...shared.coach} /></div>;
}

function cabinetPanelProps(props: CareerCabinetProps & { data: CabinetData }) {
  const { data, workspace, journey, session } = props;
  const query =
    data.account?.profile.headline?.trim() ||
    workspace?.targetDirection ||
    undefined;
  return {
    targetDirection: query ?? '',
    coach: { snapshot: data.snapshot, journey, marketQuery: query, loading: data.loading, onRefresh: data.refresh },
    profile: { account: data.account, session, snapshot: data.snapshot, workspace, loading: data.loading, onRefresh: data.refresh, onUpdateWorkspace: props.onUpdateWorkspace, onOpenAccount: props.onOpenAccount },
    market: { snapshot: data.snapshot, journey, defaultQuery: query, loading: data.loading, onRefresh: data.refresh, onNavigate: props.onNavigate },
  };
}

function CareerTrackBoard({
  journey,
  snapshot,
  account,
  targetDirection,
  onNavigate,
  onEditPremises,
}: {
  journey?: CareerJourney;
  snapshot?: ReturnType<typeof useCareerCabinetData>['snapshot'];
  account?: AccountSnapshot;
  targetDirection: string;
  onNavigate: (view: CareerCabinetView) => void;
  onEditPremises: () => void;
}) {
  const latestTrack = [...(snapshot?.turns ?? [])]
    .reverse()
    .find((turn) => turn.status === 'completed' && turn.result?.careerTrack)?.result?.careerTrack;
  return (
    <section className="career-track-board" aria-labelledby="career-track-board-title">
      <header>
        <div>
          <span className="career-cabinet-kicker">Измеримый маршрут</span>
          <h2 id="career-track-board-title">
            {latestTrack?.objective ?? 'Карьерная гипотеза формируется'}
          </h2>
        </div>
        <TrendUp size={24} />
      </header>

      <TrackTimeline items={latestTrack?.milestones ?? journey?.track ?? []} empty={!latestTrack && !journey} />
      <CareerRoutePremises
        targetRole={targetDirection}
        location={account?.profile.location ?? undefined}
        workMode={account?.profile.workMode ?? undefined}
        onEdit={onEditPremises}
      />
      <RoleHypotheses journey={journey} />

      <button className="career-primary-button" type="button" onClick={() => onNavigate('profile')}>
        Укрепить профиль <ArrowRight size={17} />
      </button>
    </section>
  );
}

export function CareerRoutePremises({
  targetRole,
  location,
  workMode,
  onEdit,
}: {
  targetRole?: string;
  location?: string;
  workMode?: AccountSnapshot['profile']['workMode'];
  onEdit: () => void;
}) {
  return (
    <section className="career-route-premises" aria-labelledby="career-route-premises-title">
      <header>
        <div>
          <span className="career-cabinet-kicker">Изменяемые предпосылки</span>
          <h3 id="career-route-premises-title">Роль и условия маршрута</h3>
        </div>
        <button type="button" onClick={onEdit}>Изменить роль и условия</button>
      </header>
      <dl>
        <div><dt>Роль и уровень</dt><dd>{targetRole?.trim() || 'Уточняются'}</dd></div>
        <div><dt>География</dt><dd>{location?.trim() || 'Не указана'}</dd></div>
        <div><dt>Формат работы</dt><dd>{routeWorkModeLabel(workMode)}</dd></div>
      </dl>
      <p>После сохранения гипотезы и поисковый запрос пересчитываются; прошлые варианты остаются обратимыми.</p>
    </section>
  );
}

type CareerTrackItem = CareerJourney['track'][number] | {
  label: string;
  successCriterion: string;
  measureAfter: string;
  expectedSignal: string;
};

function TrackTimeline({ items, empty }: { items: CareerTrackItem[]; empty: boolean }) {
  return <div className="career-track-timeline">{items.map((item, index) => {
    const milestone = 'expectedSignal' in item;
    return <article key={milestone ? `${item.label}-${item.measureAfter}` : item.id}><span>{index + 1}</span><div>
      <strong>{item.label}</strong><p>{milestone ? item.successCriterion : item.reason}</p>
      <small>{milestone ? `Проверка ${formatDate(item.measureAfter)} · ${item.expectedSignal}` : trackStatus(item.status)}</small>
    </div></article>;
  })}{empty ? <article><span>1</span><div><strong>Подтвердить профиль</strong><p>Нужны опыт, результат и карьерное ограничение.</p><small>Ожидает данных</small></div></article> : null}</div>;
}

function RoleHypotheses({ journey }: { journey?: CareerJourney }) {
  return <section className="career-role-hypotheses"><header><h3>Рабочие роли</h3><span>{journey?.roles.length ?? 0}</span></header>
    {journey?.roles.length ? journey.roles.map((role) => <article key={role.id}><Compass size={18} /><div><strong>{role.title}</strong><p>{role.basis}</p><small>{role.evidenceCount} подтверждённых опор · {role.gaps.length} пробелов</small></div></article>) : <p>Роли появятся после подтверждения минимум одного карьерного эпизода.</p>}
  </section>;
}

function todayLabel() {
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());
}

function viewTitle(view: CareerCabinetView) {
  return {
    today: 'Карьерный кабинет',
    profile: 'Профессиональный профиль',
    resume: 'Резюме',
    career: 'Карьерный трек',
    opportunities: 'Вакансии и рынок',
  }[view];
}

function viewDescription(view: CareerCabinetView) {
  return {
    today: '',
    profile: 'Компактная карьерная история, документы и проверяемые факты.',
    resume:
      'Мастер-резюме и вариант под страну — только из подтверждённых фактов, с видимыми пробелами.',
    career: 'Гипотезы ролей, milestones и наблюдаемые критерии успеха.',
    opportunities: 'Регулярные выборки, сохранённые вакансии и рыночные сигналы.',
  }[view];
}

function firstName(name: string) {
  return name.trim().split(/\s+/u)[0] || name;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${value}T00:00:00Z`));
}

function trackStatus(status: CareerJourney['track'][number]['status']) {
  return {
    complete: 'Готово',
    active: 'В работе',
    waiting: 'Ожидает',
  }[status];
}

function routeWorkModeLabel(mode?: AccountSnapshot['profile']['workMode']) {
  if (!mode) return 'Не указан';
  return {
    remote: 'Удалённо',
    hybrid: 'Гибрид',
    office: 'Офис',
    flexible: 'Гибко',
  }[mode];
}
