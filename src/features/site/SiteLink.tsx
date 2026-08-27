import React from 'react';
import { shouldHandleInApp } from './siteLink';

export interface SiteLinkProps {
  to: string;
  className?: string;
  children: React.ReactNode;
  onNavigate: (path: string) => void;
  'aria-label'?: string;
}

export function SiteLink({
  to,
  className,
  children,
  onNavigate,
  'aria-label': ariaLabel,
}: SiteLinkProps): React.JSX.Element {
  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (shouldHandleInApp(event)) {
      event.preventDefault();
      onNavigate(to);
    }
  };

  return (
    <a href={to} className={className} onClick={handleClick} aria-label={ariaLabel}>
      {children}
    </a>
  );
}

export default SiteLink;
