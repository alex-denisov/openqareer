import type { ReactNode } from 'react';
import { ChatCircleDots } from '@phosphor-icons/react';

interface PageHeaderProps {
  readonly kicker: string;
  readonly title: string;
  readonly description: string;
  readonly right?: ReactNode;
  readonly onAskConsultant?: () => void;
}

/** Единая шапка разделов кабинета: контекст, заголовок и честное пояснение. */
export function PageHeader({
  kicker,
  title,
  description,
  right,
  onAskConsultant,
}: PageHeaderProps) {
  return (
    <header className="career-page-header">
      <div className="career-page-header-copy">
        <span className="career-page-header-kicker">{kicker}</span>
        <div className="career-page-header-title-row">
          <h1>{title}</h1>
          {onAskConsultant ? (
            <button
              type="button"
              className="career-btn career-btn-secondary career-ask-consultant-btn"
              onClick={onAskConsultant}
            >
              <ChatCircleDots size={16} aria-hidden="true" />
              <span>Спросить консультанта</span>
            </button>
          ) : null}
        </div>
        <p>{description}</p>
      </div>
      {right ? <div className="career-page-header-right">{right}</div> : null}
    </header>
  );
}
