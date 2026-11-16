import { useState } from 'react';
import type { CandidateStatusToday, TodayStatusModule } from '../../../../shared/candidateStatus';
import { pluralRu } from '../../../../shared/pluralRu';
import { listNotifications } from '../../notifications/notificationsApi';
import { useTodayDay, type TodayDay } from './useTodayDay';
import type { B640Node } from '../routes';
import { useScreenChrome } from '../shell/ShellContext';
import { BlockError, BlockSkeleton } from './parts';
import {
  OnboardingPlanModule,
  ProfessionFitModule,
  RoleOptionsModule,
  VacanciesModule,
} from './roleModules';
import {
  ApplicationsModule,
  MoreActionsModule,
  NextActionModule,
  ProfileQuestionModule,
} from './searchModules';
import { getStatusToday } from './statusApi';
import { StatusSignalBlock } from './StatusSignalBlock';
import { StatusStrip } from './StatusStrip';
import { funnelLine, moduleLayout } from './todayModel';
import { useLoad } from './useLoad';

async function loadUnreadCount(signal: AbortSignal): Promise<number> {
  const page = await listNotifications({ limit: 1, signal });
  return page.unreadCount;
}

function weeklyTitle(today: TodayDay, fallback: string): string {
  const count = today.snapshot?.digest.newVacancies ?? 0;
  return count > 0
    ? pluralRu(count, ['новая вакансия', 'новые вакансии', 'новых вакансий'])
    : fallback;
}

interface ModuleProps {
  readonly module: TodayStatusModule;
  readonly status: CandidateStatusToday;
  readonly today: TodayDay;
  /** Первый модуль левой колонки: у него главная кнопка экрана. */
  readonly lead: boolean;
}

function TodayModule({ module, status, today, lead }: ModuleProps) {
  switch (module.key) {
    case 'next_action':
      return <NextActionModule today={today} lead={lead} />;
    case 'applications_summary':
      return status.status === 'job_search' ? (
        <MoreActionsModule today={today} />
      ) : (
        <ApplicationsModule today={today} />
      );
    case 'profile_question':
      return <ProfileQuestionModule title={module.title} />;
    case 'weekly_vacancies':
      return <VacanciesModule title={weeklyTitle(today, module.title)} lead={lead} />;
    case 'role_vacancies':
      return <VacanciesModule title={module.title} lead={lead} />;
    case 'role_options':
      return <RoleOptionsModule title={module.title} />;
    case 'profession_fit':
      return <ProfessionFitModule title={module.title} />;
    case 'onboarding_plan':
      return <OnboardingPlanModule title={module.title} />;
    default:
      return null;
  }
}

interface TodayBodyProps {
  readonly status: CandidateStatusToday;
  readonly today: TodayDay;
  readonly revertedTitle: string | null;
  readonly onReverted: (title: string) => void;
}

function TodayBody({ status, today, revertedTitle, onReverted }: TodayBodyProps) {
  const layout = moduleLayout(status.status, status.modules);
  // Макет s04: при «Присматриваюсь» вопрос стоит над колонками, иначе — в правой (s05b).
  const wideSignal = status.status === 'looking' || layout.side.length === 0;
  const signal = <StatusSignalBlock statusTitle={status.title} wide={wideSignal} />;
  const modules = (list: readonly TodayStatusModule[], withLead: boolean) =>
    list.map((module, index) => (
      <TodayModule
        key={module.key}
        module={module}
        status={status}
        today={today}
        lead={withLead && index === 0}
      />
    ));
  return (
    <>
      <StatusStrip
        status={status}
        progress={funnelLine(today.snapshot?.funnel)}
        revertedTitle={revertedTitle}
        onReverted={onReverted}
      />
      {wideSignal ? signal : null}
      <div className="col">{modules(layout.main, true)}</div>
      {layout.side.length > 0 ? (
        <div className="col">
          {wideSignal ? null : signal}
          {modules(layout.side, false)}
        </div>
      ) : null}
    </>
  );
}

/** s03 «Сегодня»: модули по выбранному статусу кандидата (B650, B665). */
export function TodayScreen({ node }: { readonly node: B640Node }) {
  const status = useLoad(getStatusToday);
  const [revertedTitle, setRevertedTitle] = useState<string | null>(null);
  const today = useTodayDay();
  const unread = useLoad(loadUnreadCount);
  useScreenChrome({ bellCount: unread.state === 'ready' ? unread.data : 0 });

  const twoColumns =
    status.state === 'ready' &&
    moduleLayout(status.data.status, status.data.modules).side.length > 0;
  return (
    <div
      className={twoColumns ? 'page two' : 'page one'}
      data-b640-node={node.code}
      data-b640-section={node.section}
    >
      {status.state === 'loading' ? (
        <div className="col">
          <BlockSkeleton label="Загружаем «Сегодня»" rows={3} />
        </div>
      ) : null}
      {status.state === 'error' ? (
        <div className="col">
          <BlockError text="Не удалось загрузить «Сегодня»." onRetry={status.retry} />
        </div>
      ) : null}
      {status.state === 'ready' ? (
        <TodayBody
          status={status.data}
          today={today}
          revertedTitle={revertedTitle}
          onReverted={(title) => {
            setRevertedTitle(title);
            status.retry();
          }}
        />
      ) : null}
    </div>
  );
}
