import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { VacancyRowProps } from './VacancyRow';
import { companyPathActions } from './VacancyCompanyPathPanel';
import { DetailTrustAlert } from './VacancyTrustAlert';
import type { vacancyTrustSignals } from '../../../shared/vacancyTrustSignals';
import {
  ArrowSquareOut,
  BookmarkSimple,
  CaretLeft,
  ChatCircleText,
  FileText,
  Path,
  PaperPlaneTilt,
  Target,
} from '@phosphor-icons/react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { openExternalLink } from '../../services/desktop/openExternalLink';
import { vacancySourceLabels } from '../../../shared/vacancySourceLabel';
import { pluralRu } from '../../../shared/pluralRu';
import { formatCompensationCompact } from './vacancyCompensation';
import { vacancyLevelLabel } from './VacancyScreenRowCells';
import { VacancyScreenRequirementChips } from './VacancyScreenDetails';
import { useVacancySummary } from './vacancyDetailApi';
import type { CompanyPathActions } from './VacancyCompanyPathPanel';
import { useVacancyPathCircles, type VacancyPathCirclesState } from './useVacancyPathCircles';
import type { VacancyProfileRequirement } from './vacancyProfileRequirement';
import {
  CIRCLE_CTA,
  PushCirclePage,
  PushCirclesStatus,
  PushHero,
  PushPathPage,
  PushRow,
  type CirclePage,
} from './VacancyMobilePathPages';
import { VacancyPushMore, type VacancyPushMoreAction } from './VacancyPushMore';
import { vacancyPushRowActions, type PushRowState } from './vacancyPushRowActions';
import './vacancy-push.css';

type PushPage = 'job' | 'path' | CirclePage;

const PAGE_TITLES: Record<PushPage, string> = {
  job: 'Вакансия',
  path: 'Путь к компании',
  c1: 'Круг 1',
  c2: 'Круг 2',
  c3: 'Круг 3',
};

export interface VacancyMobilePushProps {
  readonly item: MatchedVacancyItem;
  readonly onClose: () => void;
  readonly onOpenFullDescription: () => void;
  readonly onApply: () => void;
  readonly applyLabel: string;
  readonly applyDisabled: boolean;
  readonly pathActions: CompanyPathActions;
  readonly isSaved?: boolean;
  readonly onToggleSaved?: () => void | Promise<void>;
  readonly isCompanyWanted?: boolean;
  readonly onToggleCompanyWant?: () => void | Promise<void>;
  readonly onDiscuss?: () => void;
  readonly onAddToProfile?: (context: VacancyProfileRequirement) => void;
  /** Trust warning (stale, phantom, suspicious) shown above the vacancy. */
  readonly notice?: ReactNode;
  /** «Ещё»: interview stage or «Я уже откликнулся», the row's handlers (B510). */
  readonly moreActions?: readonly VacancyPushMoreAction[];
  /** The row's interview form, opened from «Ещё»; shown under the vacancy. */
  readonly overlay?: ReactNode;
}

function observedDay(item: MatchedVacancyItem): string | null {
  const value = item.cluster.sources[0]?.observedAt ?? item.cluster.firstObservedAt;
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(new Date(value));
}

function originLabel(item: MatchedVacancyItem): string {
  return [vacancySourceLabels(item.cluster.sources)[0], observedDay(item)]
    .filter(Boolean)
    .join(', ');
}

function ConditionsGroup({ item }: { readonly item: MatchedVacancyItem }) {
  const { cluster, explanation } = item;
  const origin = originLabel(item);
  const rows: readonly [string, string, boolean][] = [
    ['Уровень', vacancyLevelLabel(item), explanation.levelMatch === 'match'],
    [
      'Гео',
      cluster.canonicalLocation ?? (cluster.isRemote ? 'Удалённо' : 'Не указано'),
      !explanation.outsideGeography,
    ],
    ['Деньги', formatCompensationCompact(cluster.salary), false],
  ];
  return (
    <section className="vacancy-push-group">
      <h3 className="vacancy-push-cap">Совпадение с вашими условиями</h3>
      <div className="vacancy-push-list">
        {rows.map(([label, value, ok]) => (
          <div className="vacancy-push-kv" key={label}>
            <span>{label}</span>
            <b className={ok ? 'is-ok' : undefined}>
              {ok ? <span className="career-sr-only">Совпадает: </span> : null}
              {value}
            </b>
          </div>
        ))}
      </div>
      <p className="vacancy-push-foot">
        {cluster.salary ? 'Зарплата указана в вакансии' : 'Зарплата в вакансии не указана'}
        {origin ? `, ${origin}` : ''}.
      </p>
    </section>
  );
}

function contactsLine(state: VacancyPathCirclesState): string | undefined {
  if (state.status !== 'ready') return undefined;
  const first = state.data.circles.find((circle) => circle.circle === 1);
  if (first?.state !== 'available' || first.paths.length === 0) return 'контакты неизвестны';
  return `${pluralRu(first.paths.length, ['контакт', 'контакта', 'контактов'])} в компании`;
}

function JobActions({
  props,
  contacts,
  onOpenPath,
}: {
  readonly props: VacancyMobilePushProps;
  readonly contacts?: string;
  readonly onOpenPath: () => void;
}) {
  const { cluster } = props.item;
  return (
    <div className="vacancy-push-list">
      {cluster.canonicalCompany ? (
        <PushRow
          icon={<Path aria-hidden="true" />}
          title="Путь к компании"
          lines={contacts ? [contacts] : []}
          onClick={onOpenPath}
        />
      ) : null}
      {props.onToggleCompanyWant && cluster.canonicalCompany ? (
        <PushRow
          icon={<Target aria-hidden="true" />}
          title={props.isCompanyWanted ? 'Убрать из «Хочу»' : 'Хочу в эту компанию'}
          onClick={() => void props.onToggleCompanyWant?.()}
        />
      ) : null}
      {cluster.primaryUrl ? (
        <PushRow
          icon={<ArrowSquareOut aria-hidden="true" />}
          title="Открыть на площадке"
          onClick={() => void openExternalLink(cluster.primaryUrl)}
        />
      ) : null}
      {props.onDiscuss ? (
        <PushRow
          icon={<ChatCircleText aria-hidden="true" />}
          title="Обсудить с консультантом"
          onClick={props.onDiscuss}
        />
      ) : null}
    </div>
  );
}

function JobPage({
  props,
  circles,
  onOpenPath,
}: {
  readonly props: VacancyMobilePushProps;
  readonly circles: VacancyPathCirclesState;
  readonly onOpenPath: () => void;
}) {
  const { cluster, explanation } = props.item;
  const contacts = contactsLine(circles);
  const summary = useVacancySummary(cluster.id, cluster.descriptionSummary);
  return (
    <>
      <PushHero
        title={cluster.canonicalTitle}
        subtitle={[cluster.canonicalCompany, originLabel(props.item)].filter(Boolean).join(' · ')}
      />
      {props.notice}
      <ConditionsGroup item={props.item} />
      <div className="vacancy-push-group vacancy-push-requirements">
        <VacancyScreenRequirementChips
          cluster={cluster}
          explanation={explanation}
          onAddToProfile={props.onAddToProfile}
        />
      </div>
      <section className="vacancy-push-group">
        <h3 className="vacancy-push-cap">Описание</h3>
        <div className="vacancy-push-list">
          <p className="vacancy-push-quote">
            {summary.text ??
              (summary.loading ? 'Загружаем описание…' : 'Краткое описание пока недоступно.')}
          </p>
          <PushRow
            icon={<FileText aria-hidden="true" />}
            title="Полное описание"
            onClick={props.onOpenFullDescription}
          />
        </div>
      </section>
      <JobActions props={props} contacts={contacts} onOpenPath={onOpenPath} />
    </>
  );
}

function PushCta({
  page,
  props,
}: {
  readonly page: PushPage;
  readonly props: VacancyMobilePushProps;
}) {
  if (page === 'path') return null;
  if (page === 'job') {
    return (
      <div className="vacancy-push-cta">
        <button
          type="button"
          className="vacancy-push-primary"
          onClick={props.onApply}
          disabled={props.applyDisabled}
        >
          <PaperPlaneTilt size={18} aria-hidden="true" />
          {props.applyLabel}
        </button>
        {props.onToggleSaved ? (
          <button
            type="button"
            className="vacancy-push-round"
            aria-pressed={Boolean(props.isSaved)}
            aria-label={props.isSaved ? 'Сохранено' : 'Сохранить'}
            onClick={() => void props.onToggleSaved?.()}
          >
            <BookmarkSimple
              size={20}
              weight={props.isSaved ? 'fill' : 'regular'}
              aria-hidden="true"
            />
          </button>
        ) : null}
        <VacancyPushMore actions={props.moreActions ?? []} />
      </div>
    );
  }
  const cta = CIRCLE_CTA[page];
  const action = props.pathActions[cta.action];
  return action ? (
    <div className="vacancy-push-cta">
      <button type="button" className="vacancy-push-primary" onClick={action}>
        {cta.label}
      </button>
    </div>
  ) : null;
}

function PushBody({
  page,
  props,
  circles,
  open,
}: {
  readonly page: PushPage;
  readonly props: VacancyMobilePushProps;
  readonly circles: VacancyPathCirclesState;
  readonly open: (page: PushPage) => void;
}) {
  if (page === 'job') {
    return <JobPage props={props} circles={circles} onOpenPath={() => open('path')} />;
  }
  if (circles.status !== 'ready')
    return (
      <PushCirclesStatus state={circles} onPrepareLetter={props.pathActions.onPrepareLetter} />
    );
  if (page === 'path') {
    return <PushPathPage data={circles.data} actions={props.pathActions} onOpenCircle={open} />;
  }
  return <PushCirclePage page={page} data={circles.data} />;
}

function useEscapeBack(back: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) back();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [back]);
}

/** Each new push page starts at the top with focus on «Назад». */
function usePageTop(page: PushPage) {
  const backRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: 0 });
    backRef.current?.focus();
  }, [page]);
  return { backRef, scrollRef };
}

/** 390 px (B549, mockup 4 `?mv=job|path|c1|c2|c3`): a list row opens the
 *  vacancy as a push screen with its own back stack instead of expanding. */
export function VacancyMobilePush(props: VacancyMobilePushProps) {
  const [stack, setStack] = useState<readonly PushPage[]>(['job']);
  const page = stack.at(-1) ?? 'job';
  const circles = useVacancyPathCircles(
    props.item.cluster.id,
    Boolean(props.item.cluster.canonicalCompany),
  );
  const { backRef, scrollRef } = usePageTop(page);
  const open = (next: PushPage) => setStack((current) => [...current, next]);
  const onClose = props.onClose;
  const depth = stack.length;
  const back = useCallback(
    () => (depth > 1 ? setStack((current) => current.slice(0, -1)) : onClose()),
    [depth, onClose],
  );
  useEscapeBack(back);
  return (
    <>
      <div className="vacancy-push-backdrop" aria-hidden="true" />
      <div
        ref={scrollRef}
        className="vacancy-push"
        role="dialog"
        aria-labelledby="vacancy-push-title"
        data-push-page={page}
      >
        <header className="vacancy-push-bar">
          <button
            ref={backRef}
            type="button"
            className="vacancy-push-back"
            aria-label="Назад"
            onClick={back}
          >
            <CaretLeft size={20} aria-hidden="true" />
          </button>
          <h1 id="vacancy-push-title">{PAGE_TITLES[page]}</h1>
        </header>
        <div className="vacancy-push-body">
          <PushBody page={page} props={props} circles={circles} open={open} />
          {page === 'job' ? props.overlay : null}
        </div>
        <PushCta page={page} props={props} />
      </div>
    </>
  );
}

function applyCta(
  cluster: MatchedVacancyItem['cluster'],
  rowProps: { readonly onOpenArchive?: () => void; readonly onOpenResponses?: () => void },
  rowState: RowPushState,
): Pick<VacancyMobilePushProps, 'onApply' | 'applyLabel' | 'applyDisabled'> {
  if (rowState.applicationArchived) {
    const open = rowProps.onOpenArchive;
    return {
      onApply: open ?? (() => undefined),
      applyLabel: open ? 'Открыть архив' : 'Отклик в архиве',
      applyDisabled: !open,
    };
  }
  if (rowState.alreadyApplied) {
    const open = rowProps.onOpenResponses;
    return {
      onApply: open ?? (() => undefined),
      applyLabel: open ? 'Перейти в «Отклики»' : 'Отклик отмечен',
      applyDisabled: !open,
    };
  }
  if (rowState.externalOpened) {
    return {
      onApply: () => void rowState.handleConfirmSent(),
      applyLabel: 'Да, отклик отправлен',
      applyDisabled: false,
    };
  }
  return {
    onApply: rowState.handleApplyExternal,
    applyLabel: 'Откликнуться',
    applyDisabled: !cluster.primaryUrl,
  };
}

interface RowPushState {
  readonly applicationArchived: boolean;
  readonly alreadyApplied: boolean;
  readonly externalOpened: boolean;
  readonly handleApplyExternal: () => void;
  readonly handleConfirmSent: () => void | Promise<void>;
  readonly setInfoOpen: (open: boolean) => void;
}

/** Maps the row's props and state onto the push screen (B549). */
export function vacancyRowPushProps(
  item: MatchedVacancyItem,
  rowProps: {
    readonly onSelect: () => void;
    readonly isSaved?: boolean;
    readonly onToggleSaved?: () => void | Promise<void>;
    readonly isCompanyWanted?: boolean;
    readonly onToggleCompanyWant?: () => void | Promise<void>;
    readonly onDiscussWithConsultant?: (cluster: MatchedVacancyItem['cluster']) => void;
    readonly onAddToProfile?: (context: VacancyProfileRequirement) => void;
    readonly onOpenArchive?: () => void;
    readonly onOpenResponses?: () => void;
  },
  rowState: RowPushState,
  pathActions: CompanyPathActions,
): VacancyMobilePushProps {
  const { cluster } = item;
  return {
    item,
    onClose: rowProps.onSelect,
    onOpenFullDescription: () => rowState.setInfoOpen(true),
    ...applyCta(cluster, rowProps, rowState),
    pathActions,
    isSaved: rowProps.isSaved,
    onToggleSaved: rowProps.onToggleSaved,
    isCompanyWanted: rowProps.isCompanyWanted,
    onToggleCompanyWant: rowProps.onToggleCompanyWant,
    onDiscuss: rowProps.onDiscussWithConsultant
      ? () => rowProps.onDiscussWithConsultant?.(cluster)
      : undefined,
    onAddToProfile: rowProps.onAddToProfile,
  };
}

/** The row's push screen at 390 px: the same handlers as the expanded row. */
export function VacancyRowPush({
  item,
  rowProps,
  rowState,
}: {
  readonly item: MatchedVacancyItem;
  readonly rowProps: VacancyRowProps;
  readonly rowState: RowPushState & {
    readonly setPitchOpen: (open: boolean) => void;
    readonly trust: ReturnType<typeof vacancyTrustSignals>;
    readonly savingApplied: boolean;
  } & PushRowState;
}) {
  const more = vacancyPushRowActions(rowProps, rowState);
  const base = companyPathActions(item.cluster, rowProps, () => rowState.setPitchOpen(true));
  // Leaving for another screen closes the push, so «Подборка» returns to the list.
  const leave = (action?: () => void) =>
    action
      ? () => {
          rowProps.onSelect();
          action();
        }
      : undefined;
  const actions = {
    ...base,
    onShowPaths: leave(base.onShowPaths),
    onPrepareLetter: rowProps.onOpenLetter ? leave(base.onPrepareLetter) : base.onPrepareLetter,
  };
  return (
    <VacancyMobilePush
      {...vacancyRowPushProps(item, rowProps, rowState, actions)}
      notice={<DetailTrustAlert trust={rowState.trust} />}
      moreActions={pushMoreActions({ ...rowState, ...more })}
      overlay={more.interviewForm}
    />
  );
}

function pushMoreActions(rowState: {
  readonly applicationArchived: boolean;
  readonly alreadyApplied: boolean;
  readonly savingApplied: boolean;
  readonly onScheduleInterview?: () => void;
  readonly onConfirmAlreadyApplied?: () => void;
}): readonly VacancyPushMoreAction[] {
  if (rowState.applicationArchived) return [];
  if (rowState.alreadyApplied) {
    return rowState.onScheduleInterview
      ? [{ label: 'Назначили интервью', onSelect: rowState.onScheduleInterview }]
      : [];
  }
  return rowState.onConfirmAlreadyApplied
    ? [
        {
          label: rowState.savingApplied ? 'Сохраняем…' : 'Я уже откликнулся',
          onSelect: rowState.onConfirmAlreadyApplied,
          disabled: rowState.savingApplied,
        },
      ]
    : [];
}
