import {
  cloneElement,
  isValidElement,
  useId,
  useState,
  type FocusEventHandler,
  type MouseEventHandler,
  type ReactElement,
} from 'react';

interface TooltipTriggerProps {
  'aria-describedby'?: string;
  tabIndex?: number;
  onBlur?: FocusEventHandler<HTMLElement>;
  onFocus?: FocusEventHandler<HTMLElement>;
  onMouseEnter?: MouseEventHandler<HTMLElement>;
  onMouseLeave?: MouseEventHandler<HTMLElement>;
}

interface CareerTooltipProps {
  readonly content: string;
  readonly children: ReactElement<TooltipTriggerProps>;
}

/**
 * Candidate-facing explanations must work for both pointer and keyboard users.
 * Native `title` text is neither reliably discoverable on focus nor usable on
 * touch, so the shell owns one small, token-driven tooltip primitive (B236).
 */
export function CareerTooltip({ content, children }: CareerTooltipProps) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const existingDescription = children.props['aria-describedby'];
  const describedBy = [existingDescription, tooltipId].filter(Boolean).join(' ');
  const childTag = typeof children.type === 'string' ? children.type : undefined;
  const isKeyboardTarget =
    children.props.tabIndex !== undefined ||
    childTag === 'a' ||
    childTag === 'button' ||
    childTag === 'input' ||
    childTag === 'select' ||
    childTag === 'textarea' ||
    childTag === 'summary';

  const trigger = isValidElement(children)
    ? cloneElement(children, {
        'aria-describedby': describedBy,
        ...(!isKeyboardTarget ? { tabIndex: 0 } : {}),
        onFocus: (event) => {
          children.props.onFocus?.(event);
          setOpen(true);
        },
        onBlur: (event) => {
          children.props.onBlur?.(event);
          setOpen(false);
        },
        onMouseEnter: (event) => {
          children.props.onMouseEnter?.(event);
          setOpen(true);
        },
        onMouseLeave: (event) => {
          children.props.onMouseLeave?.(event);
          setOpen(false);
        },
      })
    : children;

  return (
    <span className="career-tooltip" data-open={open ? 'true' : undefined}>
      {trigger}
      <span id={tooltipId} className="career-tooltip-content" role="tooltip">
        {content}
      </span>
    </span>
  );
}
