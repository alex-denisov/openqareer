import { useState, type ReactNode } from 'react';
import { Icon, useIsMobile } from '../../kit';

export interface FoldProps {
  readonly title: string;
  readonly children: ReactNode;
  /** Открыт на широком экране; на 390 любой блок закрыт. */
  readonly openOnDesktop?: boolean;
  readonly className?: string;
}

/** Сворачиваемый блок правой колонки (`details.v4-fold`). */
export function Fold({ title, children, openOnDesktop = false, className }: FoldProps) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(openOnDesktop && !mobile);
  return (
    <details
      className={className ? `mod v4-fold ${className}` : 'mod v4-fold'}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="v4-fold-s">
        <span>{title}</span>
        <Icon name="down" className="v4-chev" />
      </summary>
      <div className="v4-fold-b">{children}</div>
    </details>
  );
}
