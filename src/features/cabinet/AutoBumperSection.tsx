import { Lightning, Pause, Play } from '@phosphor-icons/react';
import type { AutoBumperState } from '../../services/autoBumper';

interface AutoBumperSectionProps {
  bumperState: AutoBumperState;
  onInstantBump: () => void;
  onToggle: () => void;
}

export function AutoBumperSection({
  bumperState,
  onInstantBump,
  onToggle,
}: AutoBumperSectionProps) {
  const statusLabel =
    bumperState.lastBumpStatus === 'Success'
      ? 'Успешно'
      : bumperState.lastBumpStatus === 'Scheduled'
        ? 'Запланировано'
        : 'Ожидание';

  return (
    <section className="career-market-watch" aria-labelledby="career-bumper-title">
      <header>
        <div>
          <span>Автоматизация hh.ru</span>
          <h3 id="career-bumper-title">Авто-поднятие резюме (каждые 4ч)</h3>
        </div>
        <span className={`career-search-status is-${bumperState.isActive ? 'active' : 'paused'}`}>
          {bumperState.isActive ? 'Активен' : 'На паузе'}
        </span>
      </header>

      <div className="career-market-query-row">
        <div>
          <strong>Следующее поднятие: {bumperState.nextBumpTime}</strong>
          <small>
            Сегодня: {bumperState.bumpsToday} · Всего: {bumperState.totalBumpsCount} · Статус:{' '}
            {statusLabel}
          </small>
        </div>
        <BumperControls
          isActive={bumperState.isActive}
          onInstantBump={onInstantBump}
          onToggle={onToggle}
        />
      </div>
    </section>
  );
}

function BumperControls({
  isActive,
  onInstantBump,
  onToggle,
}: {
  isActive: boolean;
  onInstantBump: () => void;
  onToggle: () => void;
}) {
  return (
    <div style={{ display: 'flex', gap: '8px' }}>
      <button
        type="button"
        className="career-primary-button"
        style={{ padding: '6px 12px', fontSize: '13px', borderRadius: '6px' }}
        onClick={onInstantBump}
        title="Поднять резюме в поиске hh.ru прямо сейчас"
      >
        <Lightning size={15} weight="fill" /> Поднять сейчас
      </button>
      <button
        type="button"
        className="career-quiet-button"
        style={{ padding: '6px 12px', fontSize: '13px' }}
        onClick={onToggle}
        aria-label={isActive ? 'Приостановить автоподнятие' : 'Возобновить автоподнятие'}
      >
        {isActive ? <Pause size={15} /> : <Play size={15} />}
      </button>
    </div>
  );
}
