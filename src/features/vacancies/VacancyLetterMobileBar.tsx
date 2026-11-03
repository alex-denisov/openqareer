import { useEffect, useRef } from 'react';
import { CaretLeft, Sparkle } from '@phosphor-icons/react';
import './vacancy-push.css';
import './vacancy-letter-mobile-bar.css';

/**
 * Макет 9 при 390: шапка «Письма» как у остальных push-экранов — «Назад», заголовок и
 * консультант справа. Шапка «Вакансий» на экране письма не рисуется, поэтому без этой
 * строки консультант на телефоне был недоступен. Рисуется только на узком экране: на
 * широком «Назад» в карточке вакансии, консультант — в боковой панели.
 */
export function VacancyLetterMobileBar({
  onBack,
  onOpenConsultant,
}: {
  readonly onBack: () => void;
  readonly onOpenConsultant?: () => void;
}) {
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Фокус на «Назад», как у карточки вакансии на широком экране.
    backRef.current?.focus();
  }, []);
  return (
    <header className="vacancy-push-bar career-letter-mobile-bar">
      <button
        ref={backRef}
        type="button"
        className="vacancy-push-back"
        aria-label="Назад к вакансиям"
        onClick={onBack}
      >
        <CaretLeft size={20} aria-hidden="true" />
      </button>
      <h1>Письмо</h1>
      {onOpenConsultant ? (
        <button
          type="button"
          className="vacancy-push-consultant"
          aria-label="Консультант: открыть"
          onClick={onOpenConsultant}
        >
          <Sparkle size={18} aria-hidden="true" />
        </button>
      ) : null}
    </header>
  );
}
