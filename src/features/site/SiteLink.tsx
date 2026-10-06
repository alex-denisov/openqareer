import React from 'react';
import { shouldHandleInApp } from './siteLinkClick';

export interface SiteLinkProps {
  to: string;
  className?: string;
  children: React.ReactNode;
  onNavigate: (path: string) => void;
  onWarm?: () => void;
  'aria-label'?: string;
}

export function SiteLink({
  to,
  className,
  children,
  onNavigate,
  onWarm,
  'aria-label': ariaLabel,
}: SiteLinkProps): React.JSX.Element {
  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (shouldHandleInApp(event)) {
      event.preventDefault();
      onNavigate(to);
    }
  };

  return (
    <a
      href={to}
      className={className}
      onClick={handleClick}
      onFocus={onWarm}
      onMouseEnter={onWarm}
      aria-label={ariaLabel}
    >
      {children}
    </a>
  );
}
