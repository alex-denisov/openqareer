import type { CandidateSnapshot } from '../coach/coachApi';
import type { CareerJourney } from '../journey/careerJourneyEngine';
import type { IntelligenceDestination } from './CareerIntelligencePanelParts';
import { AtsReadability, NextAction } from './CareerIntelligencePanelParts';

export { NextAction } from './CareerIntelligencePanelParts';

interface CareerIntelligencePanelProps {
  snapshot?: CandidateSnapshot;
  journey?: CareerJourney;
  loading: boolean;
  onNavigate: (view: IntelligenceDestination) => void;
  /** Opens the strategist with this screen as the reason for the visit. */
  onOpenExpert: () => void;
}

/**
 * «Рынок и следующие шаги» — читаемость резюме и следующее обоснованное
 * действие.
 *
 * Регулярные выборки отсюда ушли в панель фильтров «Вакансий» — туда, где
 * кандидат смотрит сам пул (решение владельца 2026-09-02, B181). Панель
 * осталась при том, что действительно принадлежит кампании: разбор
 * читаемости и следующий шаг.
 */
export function CareerIntelligencePanel({
  snapshot,
  journey,
  loading,
  onNavigate,
  onOpenExpert,
}: CareerIntelligencePanelProps) {
  return (
    <aside
      className="career-intelligence-panel is-expanded"
      aria-labelledby="career-intelligence-title"
    >
      <header className="career-cabinet-panel-heading">
        <div>
          <span className="career-cabinet-kicker">Аналитика</span>
          <h2 id="career-intelligence-title">Рынок и следующие шаги</h2>
        </div>
        {/* B169 §8 — every screen that can use the strategist offers it here,
            with a reason attached. The contextless top-bar button is gone. */}
        <button className="career-quiet-button" type="button" onClick={onOpenExpert}>
          Настроить с консультантом
        </button>
      </header>

      <AtsReadability journey={journey} onNavigate={onNavigate} />

      <NextAction journey={journey} onNavigate={onNavigate} />

      {loading && !snapshot ? <p className="career-cabinet-loading">Обновляем рынок…</p> : null}
    </aside>
  );
}
