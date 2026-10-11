import { LinkedinLogo } from '@phosphor-icons/react';
import { LinkedinDraftCard } from '../today/LinkedinDraftCard';

export interface AutomationPostsPanelProps {
  readonly onOpenConnections: () => void;
  readonly onOpenTariffs: () => void;
}

export function AutomationPostsPanel({ onOpenConnections, onOpenTariffs }: AutomationPostsPanelProps) {
  return (
    <section className="automation-panel automation-posts-panel" data-page="posts" aria-labelledby="automation-posts-title">
      <header className="automation-panel-heading"><div><h2 id="automation-posts-title">Посты LinkedIn</h2><p>Черновик готовит продукт; публикуете вы сами. Автоматической публикации нет.</p></div><LinkedinLogo size={24} aria-hidden="true" /></header>
      <div className="automation-posts-actions">
        <button className="career-btn career-btn-secondary" type="button" onClick={onOpenConnections}>Проверить подключение LinkedIn</button>
      </div>
      <LinkedinDraftCard onOpenTariffs={onOpenTariffs} variant="pipeline" />
    </section>
  );
}
