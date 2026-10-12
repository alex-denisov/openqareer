import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import {
  CaretLeft,
  DotsThree,
  Notebook,
  Sparkle,
  Wallet,
  ShieldCheck,
} from '@phosphor-icons/react';
import { BrandMark } from '../brand/BrandMark';
import type { AuthUser } from '../coach/coachApi';
import { CareerTooltip, type TooltipTriggerProps } from './CareerTooltip';
import { useEscapeLayer } from './escapeLayers';
import type { ShellSection } from './shellNavigation';
import {
  ProfileIcon,
  ResponsesIcon,
  TodayIcon,
  VacanciesIcon,
  type SectionIconProps,
} from './sectionIcons';
import { initialsFor } from './accountIdentity';

type SectionIcon = (props: SectionIconProps) => ReactElement;
function DiaryIcon({ size = 22, active = false }: SectionIconProps) {
  return <Notebook size={size} weight={active ? 'fill' : 'regular'} aria-hidden="true" />;
}

type PrimaryTarget = Extract<
  ShellSection,
  'today' | 'profile' | 'opportunities' | 'responses' | 'diary'
>;

interface PrimaryNavigationItem {
  readonly key: PrimaryTarget;
  readonly label: string;
  readonly icon: SectionIcon;
  readonly target: PrimaryTarget;
}

const primaryNavigation: readonly PrimaryNavigationItem[] = [
  { key: 'today', label: 'Сегодня', icon: TodayIcon, target: 'today' },
  { key: 'profile', label: 'Профиль', icon: ProfileIcon, target: 'profile' },
  { key: 'opportunities', label: 'Вакансии', icon: VacanciesIcon, target: 'opportunities' },
  { key: 'responses', label: 'Отклики', icon: ResponsesIcon, target: 'responses' },
  { key: 'diary', label: 'Карьерный дневник', icon: DiaryIcon, target: 'diary' },
];

export interface NavigationButtonProps {
  readonly label: string;
  readonly icon: SectionIcon;
  readonly active: boolean;
  readonly disabled?: boolean;
  readonly lockedReason?: string;
  readonly onClick: () => void;
}

export const NavigationButton = forwardRef<
  HTMLButtonElement,
  NavigationButtonProps & TooltipTriggerProps
>(function NavigationButton(
  { label, icon: ItemIcon, active, disabled = false, lockedReason, onClick, ...tooltipProps },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`career-nav-button${active ? ' is-active' : ''}`}
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-label={disabled && lockedReason ? `${label}. ${lockedReason}` : label}
      {...tooltipProps}
    >
      <ItemIcon size={22} active={active} />
      <span>{label}</span>
    </button>
  );
});

interface NavigationStateProps {
  readonly activeView: ShellSection;
  readonly isNavigable: (view: ShellSection) => boolean;
  readonly lockedReason: (view: ShellSection) => string;
  readonly onNavigate: (view: ShellSection) => void;
}

function RailItems(props: NavigationStateProps) {
  const visibleItems = primaryNavigation.filter(
    (item) => item.key !== 'diary' || props.isNavigable('diary'),
  );
  return (
    <nav aria-label="Разделы кабинета">
      {visibleItems.map((item) => (
        <CareerTooltip key={item.key} side="right" content={item.label}>
          <NavigationButton
            label={item.label}
            icon={item.icon}
            active={
              props.activeView === item.target ||
              (props.activeView === 'automation' && item.target === 'responses')
            }
            disabled={!props.isNavigable(item.target)}
            lockedReason={props.lockedReason(item.target)}
            onClick={() => props.onNavigate(item.target)}
          />
        </CareerTooltip>
      ))}
    </nav>
  );
}

function AccountRailButton({
  session,
  disabled,
  onOpen,
}: {
  readonly session?: AuthUser | null;
  readonly disabled: boolean;
  readonly onOpen: () => void;
}) {
  const displayName = session?.displayName ?? session?.username ?? null;
  return (
    <CareerTooltip side="right" content="Аккаунт">
      <button
        className="career-account-button"
        type="button"
        disabled={disabled}
        onClick={onOpen}
        aria-label="Открыть аккаунт"
      >
        <span className="career-rail-avatar" aria-hidden="true">
          {initialsFor(displayName)}
        </span>
      </button>
    </CareerTooltip>
  );
}

function RailWalletButton({
  active,
  disabled,
  lockedReason,
  onOpen,
}: {
  readonly active: boolean;
  readonly disabled: boolean;
  readonly lockedReason: string;
  readonly onOpen: () => void;
}) {
  return (
    <CareerTooltip side="right" content={disabled ? `Тарифы. ${lockedReason}` : 'Тарифы'}>
      <button
        type="button"
        className={`career-rail-wallet${active ? ' is-active' : ''}`}
        disabled={disabled}
        aria-label={disabled ? `Тарифы. ${lockedReason}` : 'Тарифы'}
        aria-current={active ? 'page' : undefined}
        onClick={onOpen}
      >
        <Wallet size={22} weight={active ? 'fill' : 'regular'} aria-hidden="true" />
      </button>
    </CareerTooltip>
  );
}

export function CareerNavigationRail({
  session,
  sessionPending,
  ariaHidden,
  activeView,
  isNavigable,
  lockedReason,
  onNavigate,
  onOpenAccount,
}: NavigationStateProps & {
  readonly session?: AuthUser | null;
  readonly sessionPending: boolean;
  readonly ariaHidden?: boolean;
  readonly onOpenAccount: () => void;
}) {
  return (
    <aside
      id="career-rail"
      className="career-rail"
      aria-label="Основная навигация"
      aria-hidden={ariaHidden || undefined}
    >
      <button
        className="career-brand-mark"
        type="button"
        onClick={() => onNavigate('today')}
        aria-label="openqareer, главная"
      >
        <BrandMark variant="mark" size={30} />
      </button>
      <RailItems
        activeView={activeView}
        isNavigable={isNavigable}
        lockedReason={lockedReason}
        onNavigate={onNavigate}
      />
      <CareerRailBottom
        session={session}
        sessionPending={sessionPending}
        activeView={activeView}
        isNavigable={isNavigable}
        lockedReason={lockedReason}
        onNavigate={onNavigate}
        onOpenAccount={onOpenAccount}
      />
    </aside>
  );
}

function CareerRailBottom({
  session,
  sessionPending,
  activeView,
  isNavigable,
  lockedReason,
  onNavigate,
  onOpenAccount,
}: NavigationStateProps & {
  readonly session?: AuthUser | null;
  readonly sessionPending: boolean;
  readonly onOpenAccount: () => void;
}) {
  return (
    <div className="career-rail-bottom">
      {session?.role === 'admin' ? (
        <CareerTooltip side="right" content="Админка">
          <a className="career-rail-admin" href="/admin" aria-label="Админка">
            <ShieldCheck size={22} aria-hidden="true" />
          </a>
        </CareerTooltip>
      ) : null}
      <RailWalletButton
        active={activeView === 'tariffs'}
        disabled={!isNavigable('tariffs')}
        lockedReason={lockedReason('tariffs')}
        onOpen={() => onNavigate('tariffs')}
      />
      <AccountRailButton session={session} disabled={sessionPending} onOpen={onOpenAccount} />
    </div>
  );
}

interface CareerMobileTopbarProps {
  readonly session?: AuthUser | null;
  readonly sessionPending: boolean;
  readonly activeView: ShellSection;
  readonly ariaHidden?: boolean;
  readonly tariffsAvailable: boolean;
  readonly tariffsLockedReason: string;
  readonly onNavigateHome: () => void;
  readonly onNavigateResponses: () => void;
  readonly onNavigateTariffs: () => void;
  readonly onOpenAccount: () => void;
  readonly onOpenConsultant: () => void;
}

export function CareerMobileTopbar(props: CareerMobileTopbarProps) {
  const { ariaHidden, activeView } = props;
  return (
    <header className="career-topbar" aria-hidden={ariaHidden || undefined}>
      {activeView === 'automation' ? (
        <AutomationMobileTopbar {...props} />
      ) : (
        <DefaultMobileTopbar {...props} />
      )}
    </header>
  );
}

function AutomationMobileTopbar({
  onNavigateResponses,
  onOpenConsultant,
}: CareerMobileTopbarProps) {
  return (
    <>
      <button
        className="career-automation-topbar-back"
        type="button"
        aria-label="Назад к откликам"
        onClick={onNavigateResponses}
      >
        <CaretLeft size={22} aria-hidden="true" />
      </button>
      <span className="career-automation-topbar-title">Автоматизация</span>
      <button
        className="career-automation-topbar-consultant"
        type="button"
        aria-label="Открыть консультанта"
        onClick={onOpenConsultant}
      >
        <Sparkle size={22} aria-hidden="true" />
      </button>
    </>
  );
}

function DefaultMobileTopbar({
  session,
  sessionPending,
  tariffsAvailable,
  tariffsLockedReason,
  onNavigateHome,
  onNavigateTariffs,
  onOpenAccount,
}: CareerMobileTopbarProps) {
  return (
    <>
      <button
        className="career-wordmark"
        type="button"
        onClick={onNavigateHome}
        aria-label="openqareer, главная"
      >
        <BrandMark variant="mark" size={26} />
      </button>
      <CareerMobileTopbarActions
        session={session}
        sessionPending={sessionPending}
        tariffsAvailable={tariffsAvailable}
        tariffsLockedReason={tariffsLockedReason}
        onNavigateTariffs={onNavigateTariffs}
        onOpenAccount={onOpenAccount}
      />
    </>
  );
}

function CareerMobileTopbarActions({
  session,
  sessionPending,
  tariffsAvailable,
  tariffsLockedReason,
  onNavigateTariffs,
  onOpenAccount,
}: {
  readonly session?: AuthUser | null;
  readonly sessionPending: boolean;
  readonly tariffsAvailable: boolean;
  readonly tariffsLockedReason: string;
  readonly onNavigateTariffs: () => void;
  readonly onOpenAccount: () => void;
}) {
  return (
    <div className="career-topbar-actions">
      <button
        className="career-mobile-tariffs"
        type="button"
        disabled={!tariffsAvailable}
        aria-label={tariffsAvailable ? 'Тарифы' : `Тарифы. ${tariffsLockedReason}`}
        onClick={onNavigateTariffs}
      >
        <Wallet size={20} aria-hidden="true" />
        <span>Тарифы</span>
      </button>
      {session?.role === 'admin' ? (
        <a href="/admin" className="career-topbar-admin">
          Админка
        </a>
      ) : null}
      <button
        className="career-account-trigger"
        type="button"
        disabled={sessionPending}
        onClick={onOpenAccount}
        aria-label="Открыть аккаунт"
      >
        <span className="career-rail-avatar" aria-hidden="true">
          {initialsFor(session?.displayName ?? session?.username ?? null)}
        </span>
      </button>
    </div>
  );
}

function useMoreMenu(
  open: boolean,
  triggerRef: RefObject<HTMLButtonElement | null>,
  menuRef: RefObject<HTMLDivElement | null>,
  close: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    );
    first?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        !(target instanceof Node) ||
        menuRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      )
        return;
      close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, close, menuRef, triggerRef]);
}

interface MoreMenuItemData {
  readonly index: number;
  readonly label: string;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly lockedReason?: string;
  readonly onSelect: () => void;
}

function useMoreMenuKeyboard(
  isCareerEnabled: boolean,
  isDiaryEnabled: boolean,
  menuRef: RefObject<HTMLDivElement>,
  onClose: () => void,
) {
  const [focusedIndex, setFocusedIndex] = useState(() =>
    isCareerEnabled ? 0 : isDiaryEnabled ? 1 : 2,
  );
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const items = Array.from(
        event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'),
      );
      const index = items.findIndex((item) => item === event.target);
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const next = items[(index + delta + items.length) % items.length];
        if (index >= 0 && next) {
          setFocusedIndex(Number(next.dataset.menuIndex));
          next.focus();
        }
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const next = event.key === 'Home' ? items[0] : items.at(-1);
        if (next) {
          setFocusedIndex(Number(next.dataset.menuIndex));
          next.focus();
        }
      }
    },
    [onClose],
  );
  useEscapeLayer(onClose);
  return { focusedIndex, setFocusedIndex, onKeyDown, menuRef };
}

function MoreMenuItem({
  item,
  focusedIndex,
  onFocusIndex,
}: {
  readonly item: MoreMenuItemData;
  readonly focusedIndex: number;
  readonly onFocusIndex: (index: number) => void;
}) {
  return (
    <button
      data-menu-index={item.index}
      role="menuitem"
      type="button"
      tabIndex={focusedIndex === item.index ? 0 : -1}
      disabled={item.disabled}
      aria-label={
        item.disabled && item.lockedReason ? `${item.label}. ${item.lockedReason}` : item.label
      }
      aria-current={item.active ? 'page' : undefined}
      onFocus={() => onFocusIndex(item.index)}
      onClick={item.onSelect}
    >
      {item.label}
    </button>
  );
}

function MoreMenu({
  activeView,
  isCareerEnabled,
  careerLockedReason,
  isDiaryEnabled,
  onNavigate,
  onOpenExpert,
  onClose,
  menuRef,
}: {
  readonly activeView: ShellSection;
  readonly isCareerEnabled: boolean;
  readonly careerLockedReason: string;
  readonly isDiaryEnabled: boolean;
  readonly onNavigate: (view: ShellSection) => void;
  readonly onOpenExpert: () => void;
  readonly onClose: () => void;
  readonly menuRef: RefObject<HTMLDivElement>;
}) {
  const keyboard = useMoreMenuKeyboard(isCareerEnabled, isDiaryEnabled, menuRef, onClose);
  const items = buildMoreMenuItems({
    activeView,
    isCareerEnabled,
    careerLockedReason,
    isDiaryEnabled,
    onNavigate,
    onOpenExpert,
    onClose,
  });
  return (
    <div
      className="career-mobile-more-menu"
      id="career-mobile-more-menu"
      role="menu"
      aria-label="Ещё разделы"
      ref={keyboard.menuRef}
      tabIndex={-1}
      onKeyDown={keyboard.onKeyDown}
    >
      {items.map((item) => (
        <MoreMenuItem
          key={item.index}
          item={item}
          focusedIndex={keyboard.focusedIndex}
          onFocusIndex={keyboard.setFocusedIndex}
        />
      ))}
    </div>
  );
}

function buildMoreMenuItems({
  activeView,
  isCareerEnabled,
  careerLockedReason,
  isDiaryEnabled,
  onNavigate,
  onOpenExpert,
  onClose,
}: {
  readonly activeView: ShellSection;
  readonly isCareerEnabled: boolean;
  readonly careerLockedReason: string;
  readonly isDiaryEnabled: boolean;
  readonly onNavigate: (view: ShellSection) => void;
  readonly onOpenExpert: () => void;
  readonly onClose: () => void;
}): MoreMenuItemData[] {
  const options = {
    activeView,
    isCareerEnabled,
    careerLockedReason,
    onNavigate,
    onOpenExpert,
    onClose,
  };
  return [
    makeCareerMenuItem(options),
    ...(isDiaryEnabled ? [makeDiaryMenuItem(options)] : []),
    makeExpertMenuItem(options),
  ];
}

function makeCareerMenuItem(options: {
  readonly activeView: ShellSection;
  readonly isCareerEnabled: boolean;
  readonly careerLockedReason: string;
  readonly onNavigate: (view: ShellSection) => void;
  readonly onClose: () => void;
}): MoreMenuItemData {
  return {
    index: 0,
    label: 'Карьера',
    active: options.activeView === 'career',
    disabled: !options.isCareerEnabled,
    lockedReason: options.careerLockedReason,
    onSelect: () => {
      options.onClose();
      options.onNavigate('career');
    },
  };
}

function makeDiaryMenuItem(options: {
  readonly activeView: ShellSection;
  readonly onNavigate: (view: ShellSection) => void;
  readonly onClose: () => void;
}): MoreMenuItemData {
  return {
    index: 1,
    label: 'Карьерный дневник',
    active: options.activeView === 'diary',
    onSelect: () => {
      options.onClose();
      options.onNavigate('diary');
    },
  };
}

function makeExpertMenuItem(options: {
  readonly onOpenExpert: () => void;
  readonly onClose: () => void;
}): MoreMenuItemData {
  return {
    index: 2,
    label: 'Консультант',
    onSelect: () => {
      options.onClose();
      options.onOpenExpert();
    },
  };
}

export function CareerMobileNavigation({
  activeView,
  isNavigable,
  lockedReason,
  onNavigate,
  onOpenExpert,
  ariaHidden,
}: NavigationStateProps & { readonly onOpenExpert: () => void; readonly ariaHidden?: boolean }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => {
    setMoreOpen(false);
    triggerRef.current?.focus();
  }, []);
  const dismissMenu = useCallback(() => setMoreOpen(false), []);
  useEffect(() => {
    if (ariaHidden) setMoreOpen(false);
  }, [ariaHidden]);
  useMoreMenu(moreOpen, triggerRef, menuRef, dismissMenu);
  return (
    <>
      <CareerMobileMoreMenu
        open={moreOpen}
        activeView={activeView}
        isNavigable={isNavigable}
        lockedReason={lockedReason}
        onNavigate={onNavigate}
        onOpenExpert={onOpenExpert}
        onClose={closeMenu}
        menuRef={menuRef}
      />
      <CareerMobileNavigationBar
        activeView={activeView}
        isNavigable={isNavigable}
        lockedReason={lockedReason}
        onNavigate={onNavigate}
        triggerRef={triggerRef}
        ariaHidden={ariaHidden}
        moreOpen={moreOpen}
        onToggleMore={() => setMoreOpen((open) => !open)}
      />
    </>
  );
}

function CareerMobileMoreMenu({
  open,
  activeView,
  isNavigable,
  lockedReason,
  onNavigate,
  onOpenExpert,
  onClose,
  menuRef,
}: {
  readonly open: boolean;
  readonly activeView: ShellSection;
  readonly isNavigable: (view: ShellSection) => boolean;
  readonly lockedReason: (view: ShellSection) => string;
  readonly onNavigate: (view: ShellSection) => void;
  readonly onOpenExpert: () => void;
  readonly onClose: () => void;
  readonly menuRef: RefObject<HTMLDivElement>;
}) {
  if (!open) return null;
  return (
    <MoreMenu
      activeView={activeView}
      isCareerEnabled={isNavigable('opportunities')}
      careerLockedReason={lockedReason('opportunities')}
      isDiaryEnabled={isNavigable('diary')}
      onNavigate={onNavigate}
      onOpenExpert={onOpenExpert}
      onClose={onClose}
      menuRef={menuRef}
    />
  );
}

function CareerMobileNavigationBar({
  activeView,
  isNavigable,
  lockedReason,
  onNavigate,
  triggerRef,
  ariaHidden,
  moreOpen,
  onToggleMore,
}: {
  readonly activeView: ShellSection;
  readonly isNavigable: (view: ShellSection) => boolean;
  readonly lockedReason: (view: ShellSection) => string;
  readonly onNavigate: (view: ShellSection) => void;
  readonly triggerRef: RefObject<HTMLButtonElement>;
  readonly ariaHidden?: boolean;
  readonly moreOpen: boolean;
  readonly onToggleMore: () => void;
}) {
  return (
    <nav
      className="career-mobile-nav"
      aria-label="Основная навигация"
      aria-hidden={ariaHidden || undefined}
    >
      <CareerMobilePrimaryItems
        activeView={activeView}
        isNavigable={isNavigable}
        lockedReason={lockedReason}
        onNavigate={onNavigate}
      />
      <button
        ref={triggerRef}
        type="button"
        className="career-mobile-more-button"
        aria-haspopup="menu"
        aria-expanded={moreOpen}
        aria-controls="career-mobile-more-menu"
        onClick={onToggleMore}
      >
        <DotsThree size={22} aria-hidden="true" />
        <span>Ещё</span>
      </button>
    </nav>
  );
}

function CareerMobilePrimaryItems({
  activeView,
  isNavigable,
  lockedReason,
  onNavigate,
}: NavigationStateProps) {
  return primaryNavigation
    .filter((item) => item.key !== 'diary')
    .map((item) => (
      <NavigationButton
        key={item.key}
        label={item.label}
        icon={item.icon}
        active={
          activeView === item.target || (activeView === 'automation' && item.target === 'responses')
        }
        disabled={!isNavigable(item.target)}
        lockedReason={lockedReason(item.target)}
        onClick={() => onNavigate(item.target)}
      />
    ));
}
