import {
  type ReactElement,
  type ReactNode,
  useState,
  useRef,
  useId,
  cloneElement,
  useEffect,
  useCallback,
  isValidElement,
  type RefObject,
} from 'react';
import { useEscapeLayer } from './escapeLayers';

export interface TooltipTriggerProps {
  readonly onMouseEnter?: (e: React.MouseEvent) => void;
  readonly onMouseLeave?: (e: React.MouseEvent) => void;
  readonly onMouseOver?: (e: React.MouseEvent) => void;
  readonly onMouseOut?: (e: React.MouseEvent) => void;
  readonly onFocus?: (e: React.FocusEvent) => void;
  readonly onBlur?: (e: React.FocusEvent) => void;
  readonly onClick?: (e: React.MouseEvent) => void;
  readonly 'aria-describedby'?: string;
  readonly title?: string;
}

export interface CareerTooltipProps {
  readonly content: ReactNode;
  readonly children: ReactElement;
  readonly side?: 'top' | 'bottom';
  readonly className?: string;
  readonly disabled?: boolean;
}

interface Coords {
  readonly top: number;
  readonly left: number;
}

const HOVER_DELAY_MS = 300;
const TOOLTIP_MARGIN = 6;
const SCREEN_PADDING = 8;
const ESTIMATED_WIDTH = 200;
const ESTIMATED_HEIGHT = 36;

/** Вычисляет координаты подсказки с ограничением в границах экрана. */
function calculateCoords(
  trigger: HTMLElement | null,
  tooltip: HTMLElement | null,
  side: 'top' | 'bottom',
): Coords {
  if (!trigger) return { top: 0, left: 0 };
  const rect = trigger.getBoundingClientRect();
  const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const width = tooltip?.offsetWidth ?? ESTIMATED_WIDTH;
  const height = tooltip?.offsetHeight ?? ESTIMATED_HEIGHT;

  const placeAbove =
    side === 'bottom' ? false : rect.top >= height + TOOLTIP_MARGIN + SCREEN_PADDING;
  const top = placeAbove
    ? Math.max(SCREEN_PADDING, rect.top - height - TOOLTIP_MARGIN)
    : rect.bottom + TOOLTIP_MARGIN;

  const centerLeft = rect.left + rect.width / 2 - width / 2;
  const left = Math.max(SCREEN_PADDING, Math.min(screenWidth - width - SCREEN_PADDING, centerLeft));

  return { top: Math.round(top), left: Math.round(left) };
}

/** Позиционирует подсказку через свойства DOM без inline-стилей в JSX. */
function useTooltipPosition(
  triggerRef: RefObject<HTMLElement | null>,
  tooltipRef: RefObject<HTMLElement | null>,
  side: 'top' | 'bottom',
  isVisible: boolean,
  hide: () => void,
) {
  useEscapeLayer(hide, isVisible);
  const applyCoords = useCallback(() => {
    if (!tooltipRef.current) return;
    const coords = calculateCoords(triggerRef.current, tooltipRef.current, side);
    tooltipRef.current.style.top = `${coords.top}px`;
    tooltipRef.current.style.left = `${coords.left}px`;
  }, [triggerRef, tooltipRef, side]);

  useEffect(() => {
    if (!isVisible) return;
    applyCoords();

    window.addEventListener('scroll', applyCoords, true);
    window.addEventListener('resize', applyCoords);

    return () => {
      window.removeEventListener('scroll', applyCoords, true);
      window.removeEventListener('resize', applyCoords);
    };
  }, [isVisible, hide, applyCoords]);
}

/** Управляет задержкой показа (300 мс для hover, 0 для фокуса) и скрытием. */
function useTooltipVisibility(disabled: boolean, hasContent: boolean) {
  const [isVisible, setIsVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const show = useCallback(
    (delayMs = 0) => {
      if (disabled || !hasContent) return;
      clearTimer();
      if (delayMs === 0) {
        setIsVisible(true);
      } else {
        timerRef.current = setTimeout(() => setIsVisible(true), delayMs);
      }
    },
    [disabled, hasContent, clearTimer],
  );

  const hide = useCallback(() => {
    clearTimer();
    setIsVisible(false);
  }, [clearTimer]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  return { isVisible, show, hide };
}

function bindTriggerRef(child: ReactElement, triggerRef: { current: HTMLElement | null }) {
  return (node: HTMLElement | null) => {
    triggerRef.current = node;
    const existingRef = (child as { ref?: unknown }).ref;
    if (typeof existingRef === 'function') {
      existingRef(node);
    } else if (existingRef && typeof existingRef === 'object' && 'current' in existingRef) {
      (existingRef as { current: unknown }).current = node;
    }
  };
}

/** Навешивает доступность и обработчики событий на триггер. */
function cloneTriggerChild(
  child: ReactElement,
  triggerRef: { current: HTMLElement | null },
  show: (delay: number) => void,
  hide: () => void,
  tooltipId: string,
): ReactElement {
  const childProps = child.props as TooltipTriggerProps;
  const existing = childProps['aria-describedby'];
  const describedBy = existing ? `${existing} ${tooltipId}` : tooltipId;

  return cloneElement(child, {
    ref: bindTriggerRef(child, triggerRef),
    onMouseEnter: (e: React.MouseEvent) => {
      childProps.onMouseEnter?.(e);
      show(HOVER_DELAY_MS);
    },
    onMouseOver: (e: React.MouseEvent) => {
      childProps.onMouseOver?.(e);
      show(HOVER_DELAY_MS);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      childProps.onMouseLeave?.(e);
      hide();
    },
    onMouseOut: (e: React.MouseEvent) => {
      childProps.onMouseOut?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent) => {
      childProps.onFocus?.(e);
      show(0);
    },
    onBlur: (e: React.FocusEvent) => {
      childProps.onBlur?.(e);
      hide();
    },
    onClick: (e: React.MouseEvent) => {
      childProps.onClick?.(e);
      hide();
    },
    'aria-describedby': describedBy,
    title: undefined,
  });
}

/** Доступная всплывающая подсказка без inline-стилей и нативного title. */
export function CareerTooltip({
  content,
  children,
  side = 'top',
  className = '',
  disabled = false,
}: CareerTooltipProps): ReactElement {
  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);
  const tooltipId = useId();

  const { isVisible, show, hide } = useTooltipVisibility(disabled, Boolean(content));
  useTooltipPosition(triggerRef, tooltipRef, side, isVisible, hide);

  if (!isValidElement(children)) {
    return children;
  }

  const clonedChild = cloneTriggerChild(children, triggerRef, show, hide, tooltipId);

  if (!content) return clonedChild;

  return (
    <>
      {clonedChild}
      <span
        ref={tooltipRef}
        id={tooltipId}
        role="tooltip"
        className={`career-tooltip-bubble ${className}`.trim()}
        data-open={isVisible ? 'true' : undefined}
        aria-hidden={!isVisible}
      >
        {content}
      </span>
    </>
  );
}
