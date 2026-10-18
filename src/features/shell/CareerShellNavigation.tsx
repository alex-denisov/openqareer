import type { ReactNode } from 'react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import {
  CaretLeft,
  CaretRight,
  DotsThree,
  GearSix,
  Lightning,
  Notebook,
  Sparkle,
  TrendUp,
  UserCircle,
  Wallet,
  ShieldCheck,
} from '@phosphor-icons/react';
import { BrandMark } from '../brand/BrandMark';
import type { AuthUser } from '../coach/coachApi';
import { CareerTooltip, type TooltipTriggerProps } from './CareerTooltip';
import { primaryNavigation, railNavigation, type SectionIcon } from './desktopNavigationItems';
import { useEscapeLayer } from './escapeLayers';
import type { ShellSection } from './shellNavigation';

export interface NavigationButtonProps {
  readonly label: string;
  readonly ariaLabel?: string;
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
  {
    label,
    ariaLabel,
    icon: ItemIcon,
    active,
    disabled = false,
    lockedReason,
    onClick,
    ...tooltipProps
  },
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
      aria-label={
        disabled && lockedReason ? `${ariaLabel ?? label}. ${lockedReason}` : (ariaLabel ?? label)
      }
      {...tooltipProps}
    >
      <ItemIcon size={22} active={active} />
      <span>{label}</span>
    </button>
  );
});

interface NavigationStateProps {
  readonly inactive?: boolean;
  readonly activeView: ShellSection;
  readonly isNavigable: (view: ShellSection) => boolean;
  readonly lockedReason: (view: ShellSection) => string;
  readonly onNavigate: (view: ShellSection) => void;
}

function RailItems(
  props: NavigationStateProps & {
    readonly onNavigationHintChange?: (hint?: string) => void;
    readonly inactive?: boolean;
  },
) {
  const visibleItems = railNavigation;
  return (
    <nav aria-label="Разделы кабинета">
      {visibleItems.map((item) => (
        <CareerTooltip key={item.key} side="right" content={item.label} disabled>
          <NavigationButton
            label={item.label}
            ariaLabel={item.ariaLabel}
            icon={item.icon}
            active={!props.inactive && item.target === props.activeView}
            disabled={props.inactive || !props.isNavigable(item.target)}
            lockedReason={props.lockedReason(item.target)}
            onClick={() => props.onNavigate(item.target)}
            onMouseEnter={() => props.onNavigationHintChange?.(item.label)}
            onMouseLeave={() => props.onNavigationHintChange?.()}
            onFocus={() => props.onNavigationHintChange?.(item.label)}
            onBlur={() => props.onNavigationHintChange?.()}
          />
        </CareerTooltip>
      ))}
    </nav>
  );
}

function AccountRailButton({
  disabled,
  onOpen,
  onNavigationHintChange,
}: {
  readonly disabled: boolean;
  readonly onOpen: () => void;
  readonly onNavigationHintChange?: (hint?: string) => void;
}) {
  return (
    <CareerTooltip side="right" content="Настройки" disabled>
      <button
        className="career-account-button"
        type="button"
        disabled={disabled}
        onClick={() => onOpen()}
        aria-label="Открыть аккаунт"
        onMouseEnter={() => onNavigationHintChange?.('Настройки')}
        onMouseLeave={() => onNavigationHintChange?.()}
        onFocus={() => onNavigationHintChange?.('Настройки')}
        onBlur={() => onNavigationHintChange?.()}
      >
        <GearSix size="1em" aria-hidden="true" />
      </button>
    </CareerTooltip>
  );
}

function RailWalletButton({
  active,
  disabled,
  lockedReason,
  onOpen,
  onNavigationHintChange,
}: {
  readonly active: boolean;
  readonly disabled: boolean;
  readonly lockedReason: string;
  readonly onOpen: () => void;
  readonly onNavigationHintChange?: (hint?: string) => void;
}) {
  return (
    <CareerTooltip side="right" content={disabled ? `Тарифы. ${lockedReason}` : 'Тарифы'} disabled>
      <button
        type="button"
        className={`career-rail-wallet${active ? ' is-active' : ''}`}
        disabled={disabled}
        aria-label={disabled ? `Тарифы. ${lockedReason}` : 'Тарифы'}
        aria-current={active ? 'page' : undefined}
        onClick={() => onOpen()}
        onMouseEnter={() => onNavigationHintChange?.('Тарифы')}
        onMouseLeave={() => onNavigationHintChange?.()}
        onFocus={() => onNavigationHintChange?.('Тарифы')}
        onBlur={() => onNavigationHintChange?.()}
      >
        <Wallet size={22} weight={active ? 'fill' : 'regular'} aria-hidden="true" />
      </button>
    </CareerTooltip>
  );
}

export function CareerNavigationRail({
  inactive = false,
  session,
  sessionPending,
  ariaHidden,
  activeView,
  isNavigable,
  lockedReason,
  onNavigate,
  onOpenAccount,
  onNavigationHintChange,
}: NavigationStateProps & {
  readonly session?: AuthUser | null;
  readonly sessionPending: boolean;
  readonly ariaHidden?: boolean;
  readonly onOpenAccount: () => void;
  readonly onNavigationHintChange?: (hint?: string) => void;
}) {
  return (
    <aside
      id="career-rail"
      className="career-rail"
      aria-label="Основная навигация"
      aria-hidden={ariaHidden || undefined}
    >
      <RailBrandButton onNavigate={onNavigate} />
      <RailItems
        inactive={inactive}
        activeView={activeView}
        isNavigable={isNavigable}
        lockedReason={lockedReason}
        onNavigate={onNavigate}
        onNavigationHintChange={onNavigationHintChange}
      />
      <CareerRailBottom
        session={session}
        sessionPending={sessionPending}
        activeView={activeView}
        isNavigable={isNavigable}
        lockedReason={lockedReason}
        onNavigate={onNavigate}
        onOpenAccount={onOpenAccount}
        onNavigationHintChange={onNavigationHintChange}
      />
    </aside>
  );
}

function RailBrandButton({ onNavigate }: Pick<NavigationStateProps, 'onNavigate'>) {
  return (
    <button
      className="career-brand-mark"
      type="button"
      onClick={() => onNavigate('today')}
      aria-label="openqareer, главная"
    >
      <BrandMark variant="mark" size={30} />
    </button>
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
  onNavigationHintChange,
}: NavigationStateProps & {
  readonly session?: AuthUser | null;
  readonly sessionPending: boolean;
  readonly onOpenAccount: () => void;
  readonly onNavigationHintChange?: (hint?: string) => void;
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
        onNavigationHintChange={onNavigationHintChange}
      />
      <AccountRailButton
        disabled={sessionPending}
        onOpen={onOpenAccount}
        onNavigationHintChange={onNavigationHintChange}
      />
    </div>
  );
}

interface CareerMobileTopbarProps {
  readonly activeView: ShellSection;
  readonly title?: string;
  readonly ariaHidden?: boolean;
  readonly onBack?: () => void;
  readonly pendingProposalCount?: number;
  readonly expertOpen?: boolean;
  readonly onOpenConsultant: () => void;
  readonly notificationsSlot?: ReactNode;
}

export function CareerMobileTopbar(props: CareerMobileTopbarProps) {
  const content =
    props.activeView === 'responses' ? (
      <ResponsesMobileTopbar {...props} />
    ) : (
      <DefaultMobileTopbar {...props} />
    );

  return (
    <header className="career-topbar" aria-hidden={props.ariaHidden || undefined}>
      {content}
    </header>
  );
}

function ResponsesMobileTopbar(props: CareerMobileTopbarProps) {
  return (
    <MobileTopbarContent
      title={props.title ?? 'Отклики'}
      pendingProposalCount={props.pendingProposalCount}
      expertOpen={props.expertOpen}
      onOpenConsultant={props.onOpenConsultant}
      notificationsSlot={props.notificationsSlot}
    />
  );
}

function MobileTopbarContent({
  onBack,
  title,
  pendingProposalCount = 0,
  expertOpen,
  onOpenConsultant,
  notificationsSlot,
}: {
  readonly title: string;
  readonly onBack?: () => void;
  readonly pendingProposalCount?: number;
  readonly expertOpen?: boolean;
  readonly onOpenConsultant: () => void;
  readonly notificationsSlot?: ReactNode;
}) {
  return (
    <>
      <div className="career-mobile-topbar-notifications">
        {onBack ? (
          <button type="button" className="career-mobile-back-trigger" aria-label="Назад" onClick={onBack}>
            <CaretLeft size={20} aria-hidden="true" />
          </button>
        ) : notificationsSlot}
      </div>
      <h1 className="career-mobile-page-title">{title}</h1>
      <button
        className="career-mobile-consultant-trigger"
        type="button"
        aria-label="Консультант: открыть"
        aria-expanded={expertOpen || undefined}
        aria-controls="career-consultant-sheet"
        onClick={onOpenConsultant}
      >
        <Sparkle size={18} weight="regular" aria-hidden="true" />
        {pendingProposalCount > 0 ? (
          <span className="career-mobile-consultant-dot" aria-hidden="true" />
        ) : null}
      </button>
    </>
  );
}

function DefaultMobileTopbar(props: CareerMobileTopbarProps) {
  return (
    <MobileTopbarContent
      title={props.title ?? 'Сегодня'}
      onBack={props.onBack}
      pendingProposalCount={props.pendingProposalCount}
      expertOpen={props.expertOpen}
      onOpenConsultant={props.onOpenConsultant}
      notificationsSlot={props.notificationsSlot}
    />
  );
}

function useMoreMenu(
  open: boolean,
  triggerRef: RefObject<HTMLButtonElement | null>,
  menuRef: RefObject<HTMLDivElement>,
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
        triggerRef.current?.contains(target) ||
        (target instanceof Element && target.closest('.career-mobile-more-dismiss'))
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
  readonly icon: ReactNode;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly lockedReason?: string;
  readonly onSelect: () => void;
}

interface MoreMenuProps extends NavigationStateProps {
  readonly onOpenExpert: () => void;
  readonly onOpenAccount: () => void;
  readonly sessionPending: boolean;
  readonly accountOpen: boolean;
  readonly expertOpen: boolean;
  readonly onClose: () => void;
  readonly menuRef: RefObject<HTMLDivElement>;
}

type MoreMenuItemOptions = Omit<MoreMenuProps, 'menuRef'>;

function useMoreMenuKeyboard(
  initialIndex: number,
  menuRef: RefObject<HTMLDivElement>,
  onClose: () => void,
) {
  const [focusedIndex, setFocusedIndex] = useState(initialIndex);
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
      {item.icon}
      <span>{item.label}</span>
      <CaretRight size={16} weight="regular" aria-hidden="true" />
    </button>
  );
}

function MoreMenuItems({
  items,
  focusedIndex,
  onFocusIndex,
}: {
  readonly items: MoreMenuItemData[];
  readonly focusedIndex: number;
  readonly onFocusIndex: (index: number) => void;
}) {
  return items.map((item) => (
    <MoreMenuItem
      key={item.index}
      item={item}
      focusedIndex={focusedIndex}
      onFocusIndex={onFocusIndex}
    />
  ));
}

function MobileMoreMenuDismissButton({ onClose }: { readonly onClose: () => void }) {
  return (
    <button
      className="career-mobile-more-dismiss"
      type="button"
      aria-label="Закрыть меню разделов"
      tabIndex={-1}
      onClick={onClose}
    />
  );
}

function MoreMenu({
  activeView,
  isNavigable,
  lockedReason,
  onNavigate,
  onOpenExpert,
  onOpenAccount,
  sessionPending,
  accountOpen,
  expertOpen,
  onClose,
  menuRef,
}: MoreMenuProps) {
  const items = buildMoreMenuItems({
    activeView,
    isNavigable,
    lockedReason,
    onNavigate,
    onOpenExpert,
    onOpenAccount,
    sessionPending,
    accountOpen,
    expertOpen,
    onClose,
  });
  const firstEnabledIndex = items.find((item) => !item.disabled)?.index ?? 0;
  const keyboard = useMoreMenuKeyboard(firstEnabledIndex, menuRef, onClose);
  return (
    <div className="career-mobile-more-backdrop">
      <MobileMoreMenuDismissButton onClose={onClose} />
      <div
        className="career-mobile-more-menu"
        id="career-mobile-more-menu"
        role="menu"
        aria-label="Ещё разделы"
        ref={keyboard.menuRef}
        tabIndex={-1}
        onKeyDown={keyboard.onKeyDown}
      >
        <MoreMenuItems
          items={items}
          focusedIndex={keyboard.focusedIndex}
          onFocusIndex={keyboard.setFocusedIndex}
        />
      </div>
    </div>
  );
}

function makeSectionMenuItem(
  options: MoreMenuItemOptions,
  index: number,
  label: string,
  target: ShellSection,
  icon: ReactNode,
): MoreMenuItemData {
  const disabled = !options.isNavigable(target);
  return {
    index,
    label,
    icon,
    active: options.activeView === target,
    disabled,
    lockedReason: disabled ? options.lockedReason(target) : undefined,
    onSelect: () => {
      options.onClose();
      options.onNavigate(target);
    },
  };
}

function makeAccountMenuItem(options: MoreMenuItemOptions): MoreMenuItemData {
  return {
    index: 4,
    label: 'Аккаунт',
    icon: <UserCircle size={20} weight="regular" aria-hidden="true" />,
    active: options.accountOpen,
    disabled: options.sessionPending,
    lockedReason: options.sessionPending ? 'Проверяем вход' : undefined,
    onSelect: () => {
      options.onClose();
      options.onOpenAccount();
    },
  };
}

function makeExpertMenuItem(options: MoreMenuItemOptions): MoreMenuItemData {
  return {
    index: 5,
    label: 'Консультант',
    icon: <Sparkle size={20} weight="regular" aria-hidden="true" />,
    active: options.expertOpen,
    onSelect: () => {
      options.onClose();
      options.onOpenExpert();
    },
  };
}

function buildMoreMenuItems(options: MoreMenuItemOptions): MoreMenuItemData[] {
  return [
    makeSectionMenuItem(
      options,
      0,
      'Карьера',
      'career',
      <TrendUp size={20} weight="regular" aria-hidden="true" />,
    ),
    makeSectionMenuItem(
      options,
      1,
      'Карьерный дневник',
      'diary',
      <Notebook size={20} weight="regular" aria-hidden="true" />,
    ),
    makeSectionMenuItem(
      options,
      2,
      'Автоматизация',
      'automation',
      <Lightning size={20} weight="regular" aria-hidden="true" />,
    ),
    makeSectionMenuItem(
      options,
      3,
      'Тарифы',
      'tariffs',
      <Wallet size={20} weight="regular" aria-hidden="true" />,
    ),
    makeAccountMenuItem(options),
    makeExpertMenuItem(options),
  ];
}

function useMobileMoreMenu(ariaHidden?: boolean) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);
  const toggle = useCallback(() => setOpen((current) => !current), []);
  useEffect(() => {
    if (ariaHidden) setOpen(false);
  }, [ariaHidden]);
  useMoreMenu(open, triggerRef, menuRef, close);
  return { open, triggerRef, menuRef, close, toggle };
}

function isMoreSectionActive(activeView: ShellSection, accountOpen: boolean) {
  return (
    accountOpen ||
    activeView === 'career' ||
    activeView === 'diary' ||
    activeView === 'automation' ||
    activeView === 'tariffs'
  );
}

interface CareerMobileNavigationProps extends NavigationStateProps {
  readonly onOpenExpert: () => void;
  readonly onOpenAccount: () => void;
  readonly sessionPending: boolean;
  readonly accountOpen: boolean;
  readonly expertOpen: boolean;
  readonly ariaHidden?: boolean;
}

export function CareerMobileNavigation(props: CareerMobileNavigationProps) {
  const menu = useMobileMoreMenu(props.ariaHidden);
  const moreActive = isMoreSectionActive(props.activeView, props.accountOpen);
  return (
    <>
      <CareerMobileMoreMenu
        open={menu.open}
        activeView={props.activeView}
        isNavigable={props.isNavigable}
        lockedReason={props.lockedReason}
        onNavigate={props.onNavigate}
        onOpenExpert={props.onOpenExpert}
        onOpenAccount={props.onOpenAccount}
        sessionPending={props.sessionPending}
        accountOpen={props.accountOpen}
        expertOpen={props.expertOpen}
        onClose={menu.close}
        menuRef={menu.menuRef}
      />
      <CareerMobileNavigationBar
        activeView={props.activeView}
        isNavigable={props.isNavigable}
        lockedReason={props.lockedReason}
        onNavigate={props.onNavigate}
        triggerRef={menu.triggerRef}
        ariaHidden={props.ariaHidden}
        moreOpen={menu.open}
        moreActive={moreActive}
        onToggleMore={menu.toggle}
      />
    </>
  );
}

function CareerMobileMoreMenu({ open, ...props }: MoreMenuProps & { readonly open: boolean }) {
  if (!open) return null;
  return <MoreMenu {...props} />;
}

function CareerMobileNavigationBar({
  activeView,
  isNavigable,
  lockedReason,
  onNavigate,
  triggerRef,
  ariaHidden,
  moreOpen,
  moreActive,
  onToggleMore,
}: {
  readonly activeView: ShellSection;
  readonly isNavigable: (view: ShellSection) => boolean;
  readonly lockedReason: (view: ShellSection) => string;
  readonly onNavigate: (view: ShellSection) => void;
  readonly triggerRef: RefObject<HTMLButtonElement>;
  readonly ariaHidden?: boolean;
  readonly moreOpen: boolean;
  readonly moreActive: boolean;
  readonly onToggleMore: () => void;
}) {
  return (
    <nav className="career-mobile-nav" aria-label="Разделы" aria-hidden={ariaHidden || undefined}>
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
        aria-current={moreActive ? 'page' : undefined}
        onClick={onToggleMore}
      >
        <DotsThree size={24} weight="regular" aria-hidden="true" />
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
        active={activeView === item.target}
        disabled={!isNavigable(item.target)}
        lockedReason={lockedReason(item.target)}
        onClick={() => onNavigate(item.target)}
      />
    ));
}
