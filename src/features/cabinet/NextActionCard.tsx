import { ArrowRight, Sparkle } from '@phosphor-icons/react';
import type { CareerJourney } from '../journey/careerJourneyEngine';
import type { CareerCabinetView } from './cabinetViews';

/**
 * Одна рекомендация на кабинет: что делать сейчас и почему именно это.
 *
 * Жила на «Сегодня» — экране, который только рекомендовал. «Пульт» свёл
 * кандидата и его досье на «Главную», и карточка встала в правый рельс рядом с
 * оценкой, из которой рекомендация и следует. Прежние плитки состояния цикла и
 * список «требует внимания» ушли: досье теперь на том же экране и показывает
 * это само, своей очередью подтверждения.
 */
interface NextActionCardProps {
  readonly name: string;
  readonly journey?: CareerJourney;
  readonly loading: boolean;
  /**
   * True, пока идёт импорт, создавший факты этой сессии. Серверное чтение
   * кабинета сделано до него, поэтому числа досье устарели, а не равны нулю
   * (B160 §3).
   */
  readonly importing?: boolean;
  readonly onNavigate: (view: CareerCabinetView) => void;
  readonly onOpenExpert: () => void;
}

export function NextActionCard({
  name,
  journey,
  loading,
  importing = false,
  onNavigate,
  onOpenExpert,
}: NextActionCardProps) {
  const action = importing ? undefined : journey?.nextAction;
  return (
    <section className="career-today-action" aria-labelledby="career-today-action-title">
      <span className="career-cabinet-kicker">Следующий шаг</span>
      <h2 id="career-today-action-title">
        {action?.headline ??
          (importing
            ? 'Импортируем профиль — идёт импорт'
            : loading
              ? 'Собираем карьерную картину…'
              : `${firstName(name)}, начнём с одного подтверждённого результата`)}
      </h2>
      <p>
        {action?.reason ??
          (importing
            ? 'Источник ещё отдаёт данные. Пока импорт не закончился, любое число на этом экране было бы догадкой.'
            : 'Пока в профиле нет подтверждённых фактов, любая рекомендация была бы догадкой.')}
      </p>
      {action?.expectedChange ? (
        <p className="career-today-expected">
          <Sparkle size={16} weight="fill" />
          {action.expectedChange}
        </p>
      ) : null}
      <div className="career-today-action-buttons">
        <button
          className="career-primary-button"
          type="button"
          onClick={() => onNavigate(destinationView(action?.destination))}
        >
          {action?.label ?? 'Разобрать факты'}
          <ArrowRight size={17} weight="bold" />
        </button>
        <button className="career-quiet-button" type="button" onClick={onOpenExpert}>
          Обсудить со стратегом
        </button>
      </div>
    </section>
  );
}

function destinationView(
  destination?: CareerJourney['nextAction']['destination'],
): CareerCabinetView {
  return destination && destination !== 'today' ? destination : 'today';
}

function firstName(name: string): string {
  return name.trim().split(/\s+/u)[0] || name;
}
