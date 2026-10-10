import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from 'react';
import { DotsThree, Notebook, Wallet, ShieldCheck } from '@phosphor-icons/react';
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

type PrimaryTarget = Extract<ShellSection, 'today' | 'profile' | 'opportunities' | 'responses' | 'diary'>;

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
  return (
    <nav aria-label="Разделы кабинета">
      {primaryNavigation.map((item) => (
        <CareerTooltip key={item.key} side="right" content={item.label}>
          <NavigationButton
            label={item.label}
            icon={item.icon}
            active={props.activeView === item.target}
            disabled={!props.isNavigable(item.target)}
            lockedReason={props.lockedReason(item.target)}
            onClick={() => props.onNavigate(item.target)}
          />
        </CareerTooltip>
      ))}
    </nav>
  );
}

function AccountRailButton({ session, disabled, onOpen }: { readonly session?: AuthUser | null; readonly disabled: boolean; readonly onOpen: () => void }) {
  const displayName = session?.displayName ?? session?.username ?? null;
  return (
    <CareerTooltip side="right" content="Аккаунт">
      <button className="career-account-button" type="button" disabled={disabled} onClick={onOpen} aria-label="Открыть аккаунт">
        <span className="career-rail-avatar" aria-hidden="true">{initialsFor(displayName)}</span>
      </button>
    </CareerTooltip>
  );
}

function RailWalletButton({ active, disabled, lockedReason, onOpen }: {
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
    <aside id="career-rail" className="career-rail" aria-label="Основная навигация" aria-hidden={ariaHidden || undefined}>
      <button className="career-brand-mark" type="button" onClick={() => onNavigate('today')} aria-label="openqareer, главная">
        <BrandMark variant="mark" size={30} />
      </button>
      <RailItems activeView={activeView} isNavigable={isNavigable} lockedReason={lockedReason} onNavigate={onNavigate} />
      <div className="career-rail-bottom">
        {session?.role === 'admin' ? (
          <CareerTooltip side="right" content="Админка">
            <a className="career-rail-admin" href="/admin" aria-label="Админка"><ShieldCheck size={22} aria-hidden="true" /></a>
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
    </aside>
  );
}

export function CareerMobileTopbar({
  session,
  sessionPending,
  ariaHidden,
  tariffsAvailable,
  tariffsLockedReason,
  onNavigateHome,
  onNavigateTariffs,
  onOpenAccount,
}: {
  readonly session?: AuthUser | null;
  readonly sessionPending: boolean;
  readonly ariaHidden?: boolean;
  readonly tariffsAvailable: boolean;
  readonly tariffsLockedReason: string;
  readonly onNavigateHome: () => void;
  readonly onNavigateTariffs: () => void;
  readonly onOpenAccount: () => void;
}) {
  return (
    <header className="career-topbar" aria-hidden={ariaHidden || undefined}>
      <button className="career-wordmark" type="button" onClick={onNavigateHome} aria-label="openqareer, главная">
        <BrandMark variant="mark" size={26} />
      </button>
      <div className="career-topbar-actions">
        <button
          className="career-mobile-tariffs"
          type="button"
          disabled={!tariffsAvailable}
          aria-label={tariffsAvailable ? 'Тарифы' : `Тарифы. ${tariffsLockedReason}`}
          onClick={onNavigateTariffs}
        >
          <Wallet size={20} aria-hidden="true" /> <span>Тарифы</span>
        </button>
        {session?.role === 'admin' ? <a href="/admin" className="career-topbar-admin">Админка</a> : null}
        <button className="career-account-trigger" type="button" disabled={sessionPending} onClick={onOpenAccount} aria-label="Открыть аккаунт">
          <span className="career-rail-avatar" aria-hidden="true">{initialsFor(session?.displayName ?? session?.username ?? null)}</span>
        </button>
      </div>
    </header>
  );
}

function useMoreMenu(open: boolean, triggerRef: RefObject<HTMLButtonElement | null>, menuRef: RefObject<HTMLDivElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    first?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, close, menuRef, triggerRef]);
}

function MoreMenu({
  activeView,
  isCareerEnabled,
  careerLockedReason,
  isDiaryEnabled,
  diaryLockedReason,
  onNavigate,
  onOpenExpert,
  onClose,
  menuRef,
}: {
  readonly activeView: ShellSection;
  readonly isCareerEnabled: boolean;
  readonly careerLockedReason: string;
  readonly isDiaryEnabled: boolean;
  readonly diaryLockedReason: string;
  readonly onNavigate: (view: ShellSection) => void;
  readonly onOpenExpert: () => void;
  readonly onClose: () => void;
  readonly menuRef: RefObject<HTMLDivElement>;
}) {
  const [focusedIndex, setFocusedIndex] = useState(() => isCareerEnabled ? 0 : isDiaryEnabled ? 1 : 2);
  useEscapeLayer(onClose);
  return (
    <div className="career-mobile-more-menu" id="career-mobile-more-menu" role="menu" aria-label="Ещё разделы" ref={menuRef} tabIndex={-1}
      onKeyDown={(event) => {
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
        const index = items.findIndex((item) => item === event.target);
        if (event.key === 'Escape') { event.preventDefault(); onClose(); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const delta = event.key === 'ArrowDown' ? 1 : -1;
          const next = items[(index + delta + items.length) % items.length];
          if (index >= 0 && next) { setFocusedIndex(Number(next.dataset.menuIndex)); next.focus(); }
        }
        if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          const next = event.key === 'Home' ? items[0] : items.at(-1);
          if (next) { setFocusedIndex(Number(next.dataset.menuIndex)); next.focus(); }
        }
      }}
    >
      <button data-menu-index="0" role="menuitem" type="button" tabIndex={focusedIndex === 0 && isCareerEnabled ? 0 : -1} disabled={!isCareerEnabled} aria-label={!isCareerEnabled ? `Карьера. ${careerLockedReason}` : 'Карьера'} aria-current={activeView === 'career' ? 'page' : undefined} onClick={() => { onClose(); onNavigate('career'); }}>Карьера</button>
      <button data-menu-index="1" role="menuitem" type="button" tabIndex={focusedIndex === 1 && isDiaryEnabled ? 0 : -1} disabled={!isDiaryEnabled} aria-label={!isDiaryEnabled ? `Карьерный дневник. ${diaryLockedReason}` : 'Карьерный дневник'} aria-current={activeView === 'diary' ? 'page' : undefined} onClick={() => { onClose(); onNavigate('diary'); }}>Карьерный дневник</button>
      <button data-menu-index="2" role="menuitem" type="button" tabIndex={focusedIndex === 2 || (!isCareerEnabled && !isDiaryEnabled) ? 0 : -1} onClick={() => { onClose(); onOpenExpert(); }}>Консультант</button>
    </div>
  );
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
      {moreOpen ? (
        <MoreMenu activeView={activeView} isCareerEnabled={isNavigable('opportunities')} careerLockedReason={lockedReason('opportunities')} isDiaryEnabled={isNavigable('diary')} diaryLockedReason={lockedReason('diary')} onNavigate={onNavigate} onOpenExpert={onOpenExpert} onClose={closeMenu} menuRef={menuRef} />
      ) : null}
      <nav className="career-mobile-nav" aria-label="Основная навигация" aria-hidden={ariaHidden || undefined}>
        {primaryNavigation.filter((item) => item.key !== 'diary').map((item) => (
          <NavigationButton key={item.key} label={item.label} icon={item.icon} active={activeView === item.target} disabled={!isNavigable(item.target)} lockedReason={lockedReason(item.target)} onClick={() => onNavigate(item.target)} />
        ))}
        <button ref={triggerRef} type="button" className="career-mobile-more-button" aria-haspopup="menu" aria-expanded={moreOpen} aria-controls="career-mobile-more-menu" onClick={() => setMoreOpen((open) => !open)}>
          <DotsThree size={22} aria-hidden="true" /><span>Ещё</span>
        </button>
      </nav>
    </>
  );
}
