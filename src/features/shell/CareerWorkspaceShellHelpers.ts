import { createElement, useEffect, useRef, useState } from 'react';
import { CaretDown, Sparkle } from '@phosphor-icons/react';
import { useEscapeLayer } from './escapeLayers';
import { apiFetch, readDataArray, readDataObject } from '../coach/apiClient';
import type {
  ConsultantConversationSummary,
  ConsultantConversationDetail,
} from '../../../server/data/candidateStore';
import { getCareerCommands } from '../coach/careerCommandApi';
import type { CoachResult, CareerCommand } from '../coach/coachApi';
import type { CoachTurnStage } from '../coach/coachApi';
import type { ShellSection } from './shellNavigation';

export type ShellView = ShellSection;

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

export function hasClosedDesktopExpertPreference(): boolean {
  return (
    matchesMedia('(min-width: 1280px)') &&
    ['closed', 'strip'].includes(readDesktopExpertPreference() ?? '')
  );
}

export function initialExpertPanelOpen(sessionPending: boolean, _initialView: ShellView): boolean {
  if (typeof window === 'undefined') return false;
  const desktop = matchesMedia('(min-width: 1280px)');
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
  onExpand,
}: {
  count: number;
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
    count > 0
      ? createElement('span', { className: 'consultant-strip-dot', 'aria-hidden': true })
      : null,
    count > 0 ? createElement('span', { className: 'consultant-strip-count' }, count) : null,
    createElement('span', { className: 'consultant-strip-title' }, 'Консультант'),
    createElement(Sparkle, { size: 20, 'aria-hidden': true }),
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
export function usePendingConsultantProposals(result: CoachResult | undefined, turnKey?: string) {
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
  today: 'Сегодня',
};
export const STAGE_INITIAL_REPLICA: Record<CoachTurnStage, string> = {
  profile: 'Покажу, что срежет рекрутер за 30 секунд, и предложу правки по фактам вашего профиля.',
  career: 'Разберём, какие роли вам реально подходят и как их называют в разных компаниях.',
  vacancies: 'Выберите вакансию — сравню её требования с вашим опытом и скажу, где пробелы.',
  responses: 'Подскажу, кому и когда напомнить о себе и что написать.',
  interviews: 'Соберу вопросы, которые вам вероятно зададут, и ответы из вашего опыта.',
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
