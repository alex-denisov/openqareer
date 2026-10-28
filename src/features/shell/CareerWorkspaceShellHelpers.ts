import {
  createElement,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { CaretDoubleLeft, CaretDown, Sparkle } from '@phosphor-icons/react';
import { useEscapeLayer } from './escapeLayers';
import { apiFetch, readDataArray, readDataObject } from '../coach/apiClient';
import type {
  ConsultantConversationSummary,
  ConsultantConversationDetail,
} from '../../../server/data/candidateStore';
import { getCareerCommands } from '../coach/careerCommandApi';
import type { CoachResult, CareerCommand } from '../coach/coachApi';
import type { CoachTurnStage, CoachTurnSubject } from '../coach/coachApi';
import type { ShellSection } from './shellNavigation';

export type ShellView = ShellSection;

export interface ExpertPanelConfig {
  open: boolean;
  stage: CoachTurnStage;
  subject?: CoachTurnSubject;
  subjectTitle?: string;
  initialPrompt?: string;
  /** Set when the opener asked to send `initialPrompt` at once («Обсудить», G5 A2);
   *  a new value per request, so the same question can be asked twice. */
  sendRequest?: number;
}

export interface OpenExpertOptions {
  /** Send `initialPrompt` as the candidate's message instead of leaving it in the input. */
  readonly send?: boolean;
  /** Only switch the consultant's context (tab, selected company); the panel stays as it is. */
  readonly contextOnly?: boolean;
}

let expertSendRequest = 0;

export function openExpertPanel(
  setConfig: Dispatch<SetStateAction<ExpertPanelConfig>>,
  setExpanded: Dispatch<SetStateAction<boolean>>,
  setAccountOpen: Dispatch<SetStateAction<boolean>>,
  activeView: ShellView,
  isCompactViewport: boolean,
  stage?: CoachTurnStage,
  subject?: CoachTurnSubject,
  subjectTitle?: string,
  initialPrompt?: string,
  options?: OpenExpertOptions,
) {
  if (options?.contextOnly) {
    const contextStage = stage ?? stageForView(activeView);
    setConfig((previous) => ({
      ...previous,
      stage: contextStage,
      subject,
      subjectTitle,
      initialPrompt: undefined,
      sendRequest: undefined,
    }));
    return;
  }
  setAccountOpen(false);
  const sendRequest = options?.send && initialPrompt ? ++expertSendRequest : undefined;
  setExpanded(isCompactViewport);
  const nextStage = stage ?? stageForView(activeView);
  setConfig((previous) =>
    // Значок консультанта на открытом плане адаптации сохраняет контекст плана (макет 10, 390).
    !subject &&
    !subjectTitle &&
    previous.stage === nextStage &&
    previous.subject?.kind === 'adaptation'
      ? { ...previous, open: true, initialPrompt, sendRequest }
      : { open: true, stage: nextStage, subject, subjectTitle, initialPrompt, sendRequest },
  );
}

export function openIntakeConsultantPanel(
  openExpert: (
    stage?: CoachTurnStage,
    subject?: CoachTurnSubject,
    subjectTitle?: string,
    initialPrompt?: string,
  ) => void,
  setExpanded: Dispatch<SetStateAction<boolean>>,
  prompt?: string,
) {
  openExpert('today', undefined, 'Старт', prompt);
  setExpanded(true);
}

export function updateExpertStage(
  setConfig: Dispatch<SetStateAction<ExpertPanelConfig>>,
  stage: CoachTurnStage,
) {
  setConfig((previous) => ({
    ...previous,
    stage,
    subject: undefined,
    subjectTitle: undefined,
    initialPrompt: undefined,
  }));
}

export function focusConsultantTrigger() {
  const trigger = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      '.career-mobile-consultant-trigger, .consultant-strip-button',
    ),
  ).find((candidate) => candidate.getClientRects().length > 0);
  trigger?.focus();
}

export function closeExpertPanel(
  setConfig: Dispatch<SetStateAction<ExpertPanelConfig>>,
  setExpanded: Dispatch<SetStateAction<boolean>>,
  focusConsultantTrigger: () => void,
) {
  setExpanded(false);
  setConfig((previous) => ({ ...previous, open: false }));
  window.requestAnimationFrame(focusConsultantTrigger);
}

export const SESSION_GATE_DELAY_MS = 4_000;
export const DESKTOP_EXPERT_PREFERENCE_KEY = 'openqareer.desktop-expert-panel';

export const pageNames: Record<ShellView, string> = {
  today: 'Сегодня',
  profile: 'Профиль',
  resume: 'Резюме',
  career: 'Карьера',
  opportunities: 'Вакансии',
  responses: 'Отклики',
  notifications: 'Уведомления',
  automation: 'Автоматизация',
  diary: 'Карьерный дневник',
  tariffs: 'Тарифы',
};

export function stageForView(view: ShellView): CoachTurnStage {
  if (view === 'diary') return 'diary';
  if (view === 'profile') return 'profile';
  if (view === 'career') return 'career';
  if (view === 'opportunities') return 'vacancies';
  if (view === 'responses' || view === 'automation') return 'responses';
  return 'today';
}

export function readDesktopExpertPreference(): 'open' | 'closed' | 'strip' | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(DESKTOP_EXPERT_PREFERENCE_KEY);
    return value === 'open' || value === 'closed' || value === 'strip' ? value : null;
  } catch {
    return null;
  }
}

export function matchesMedia(query: string): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(query).matches
  );
}

// The consultant docks beside the page only from 1280 px; a narrower desktop window keeps
// the page columns and opens the consultant as an overlay over the strip.
export const DOCKED_CONSULTANT_QUERY = '(min-width: 1280px)';

export function hasClosedDesktopExpertPreference(): boolean {
  return (
    matchesMedia(DOCKED_CONSULTANT_QUERY) &&
    ['closed', 'strip'].includes(readDesktopExpertPreference() ?? '')
  );
}

export function initialExpertPanelOpen(sessionPending: boolean, _initialView: ShellView): boolean {
  if (typeof window === 'undefined') return false;
  const desktop = matchesMedia(DOCKED_CONSULTANT_QUERY);
  if (desktop && ['closed', 'strip'].includes(readDesktopExpertPreference() ?? '')) return false;
  // While the session is checked the panel stays on the phone sheet and a wide desktop; a
  // narrowed desktop window keeps its columns until the candidate opens the consultant.
  if (sessionPending) return desktop || !matchesMedia('(min-width: 761px)');
  return desktop;
}

// The window can be resized while the cabinet is open: below the desktop width the
// consultant folds away so the screen keeps its columns, above it the panel returns
// unless the candidate closed it on purpose.
export function expertPanelOpenOnWidthChange(wide: boolean): boolean {
  return wide && !['closed', 'strip'].includes(readDesktopExpertPreference() ?? '');
}

export function ConsultantStripButton({
  count,
  stageTitle,
  onExpand,
}: {
  count: number;
  stageTitle?: string;
  onExpand?: () => void;
}) {
  return createElement(
    'button',
    {
      type: 'button',
      className: 'consultant-strip-button',
      'aria-label': count ? 'Развернуть консультанта, есть предложение' : 'Развернуть консультанта',
      'aria-expanded': false,
      onClick: onExpand,
    },
    createElement(
      'span',
      { className: 'consultant-strip-icon', 'aria-hidden': true },
      createElement(Sparkle, { size: 20, 'aria-hidden': true }),
    ),
    count > 0
      ? createElement('span', { className: 'consultant-strip-dot', 'aria-hidden': true })
      : null,
    count > 0 ? createElement('span', { className: 'consultant-strip-count' }, count) : null,
    createElement('span', { className: 'consultant-strip-title' }, 'Консультант'),
    createElement('span', { className: 'consultant-strip-stage' }, stageTitle),
    createElement(CaretDoubleLeft, {
      className: 'consultant-strip-caret',
      size: 20,
      'aria-hidden': true,
    }),
  );
}
function useMobileStagePicker() {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  useEscapeLayer(() => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrapper.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [open]);
  return { open, setOpen, wrapper };
}
export function MobileConsultantStagePicker({
  stage,
  onStageChange,
}: {
  stage: CoachTurnStage;
  onStageChange?: (stage: CoachTurnStage) => void;
}) {
  const { open, setOpen, wrapper } = useMobileStagePicker();
  return createElement(
    'div',
    { className: 'career-expert-stage-picker consultant-mobile-stage-picker', ref: wrapper },
    createElement(
      'button',
      {
        className: 'career-expert-stage-button',
        type: 'button',
        'aria-label': 'Выбрать раздел консультанта',
        'aria-expanded': open,
        disabled: !onStageChange,
        onClick: () => setOpen((current) => !current),
      },
      createElement(CaretDown, { size: '1em', 'aria-hidden': true }),
    ),
    open
      ? createElement(
          'div',
          {
            className: 'career-expert-stage-menu',
            role: 'group',
            'aria-label': 'Раздел консультанта',
          },
          Object.entries(STAGE_TITLE).map(([targetStage, label]) =>
            createElement(
              'button',
              {
                key: targetStage,
                type: 'button',
                'aria-pressed': targetStage === stage,
                onClick: () => {
                  onStageChange?.(targetStage as CoachTurnStage);
                  setOpen(false);
                },
              },
              label,
            ),
          ),
        )
      : null,
  );
}

export function pendingConsultantProposalCount(
  result: CoachResult | undefined,
  commands: CareerCommand[],
  turnKey?: string,
): number {
  return (
    result?.actionProposals.filter(
      (proposal) =>
        !commands.some(
          (command) =>
            command.provenance?.strategyDecisionId === turnKey &&
            command.proposal.kind === proposal.kind &&
            command.proposal.objective === proposal.objective,
        ),
    ).length ?? 0
  );
}
export function usePendingConsultantProposals(
  result: CoachResult | undefined,
  turnKey?: string,
  onCountChange?: (count: number) => void,
  loading = false,
) {
  const [revision, setRevision] = useState(0);
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true;
    setCount(0);
    if (!result) return;
    void getCareerCommands()
      .then((commands) => {
        if (active) setCount(pendingConsultantProposalCount(result, commands, turnKey));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [result, turnKey, revision]);
  useEffect(() => {
    onCountChange?.(loading ? 0 : count);
  }, [count, loading, onCountChange]);
  return { count, refreshProposalCount: () => setRevision((current) => current + 1) };
}

async function readConsultantHistory(conversationId?: string) {
  const response = await apiFetch(
    `/api/v1/candidate/consultant-history${conversationId ? `/${encodeURIComponent(conversationId)}` : ''}`,
  );
  return conversationId
    ? readDataObject<ConsultantConversationDetail>(response)
    : readDataArray<ConsultantConversationSummary>(response);
}

export const STAGE_TITLE: Record<CoachTurnStage, string> = {
  profile: 'Профиль',
  career: 'Карьера',
  vacancies: 'Вакансии',
  responses: 'Отклики',
  interviews: 'Интервью',
  diary: 'Карьерный дневник',
  today: 'Сегодня',
};
export const STAGE_INITIAL_REPLICA: Record<CoachTurnStage, string> = {
  profile: 'Покажу, что срежет рекрутер за 30 секунд, и предложу правки по фактам вашего профиля.',
  career: 'Разберём, какие роли вам реально подходят и как их называют в разных компаниях.',
  vacancies: 'Выберите вакансию — сравню её требования с вашим опытом и скажу, где пробелы.',
  responses: 'Подскажу, кому и когда напомнить о себе и что написать.',
  interviews: 'Соберу вопросы, которые вам вероятно зададут, и ответы из вашего опыта.',
  diary: 'Обсудим план адаптации, ожидания и следующий проверяемый шаг.',
  today: 'Скажу, какой шаг сегодня даст больше всего.',
};

export function useConsultantHistory(identity: string | undefined) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<ConsultantConversationSummary[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  const [historicalConversation, setHistoricalConversation] =
    useState<ConsultantConversationDetail>();
  const historyRequest = useRef(0);
  useEffect(() => {
    ++historyRequest.current;
    setHistoryOpen(false);
    setHistoryItems([]);
    setHistoricalConversation(undefined);
    return () => {
      ++historyRequest.current;
    };
  }, [identity]);
  async function loadHistory(conversationId?: string) {
    const request = ++historyRequest.current;
    setHistoryOpen(true);
    setHistoryBusy(true);
    setHistoryError(undefined);
    try {
      const result = await readConsultantHistory(conversationId);
      if (request !== historyRequest.current) return;
      if (!Array.isArray(result)) {
        setHistoricalConversation(result);
        setHistoryOpen(false);
      } else {
        setHistoryItems(result);
      }
    } catch {
      if (request === historyRequest.current)
        setHistoryError('Не удалось загрузить историю бесед. Проверьте подключение.');
    } finally {
      if (request === historyRequest.current) setHistoryBusy(false);
    }
  }
  return {
    historyOpen,
    setHistoryOpen,
    historyItems,
    historyBusy,
    historyError,
    historicalConversation,
    setHistoricalConversation,
    historyRequest,
    loadHistory,
  };
}
