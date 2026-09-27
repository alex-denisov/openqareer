import type { ReactNode } from 'react';

interface PageHeaderProps {
  readonly kicker: string;
  readonly title: string;
  readonly description: string;
  readonly right?: ReactNode;
}

/** Единая шапка разделов кабинета: контекст, заголовок и честное пояснение. */
export function PageHeader({ kicker, title, description, right }: PageHeaderProps) {
  return (
    <header className="career-page-header">
      <div className="career-page-header-copy">
        <span className="career-page-header-kicker">{kicker}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {right ? <div className="career-page-header-right">{right}</div> : null}
    </header>
  );
}
