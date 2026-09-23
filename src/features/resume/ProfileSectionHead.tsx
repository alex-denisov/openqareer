import type { ReactNode } from 'react';

export function SectionHead({
  id,
  title,
  count,
  imported,
  emptyTag,
  action,
}: {
  readonly id: string;
  readonly title: string;
  readonly count?: string;
  readonly imported?: boolean;
  readonly emptyTag?: boolean;
  readonly action?: ReactNode;
}) {
  return (
    <div className="career-profile-screen-section-head">
      <h2 id={id}>{title}</h2>
      {count ? <span className="career-profile-screen-section-count">{count}</span> : null}
      {imported ? <span className="career-profile-screen-tag is-accent">Импортировано</span> : null}
      {emptyTag ? <span className="career-profile-screen-tag">Пусто</span> : null}
      {action ? <div className="career-profile-screen-section-head-actions">{action}</div> : null}
    </div>
  );
}
