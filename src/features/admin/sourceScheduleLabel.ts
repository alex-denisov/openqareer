/**
 * Расписание площадки одной строкой (B204).
 *
 * Администратор смотрит на список из 195 площадок и должен без раскрытия
 * карточки понять, когда эту опросят и почему не раньше. Отсюда одна строка,
 * а не таблица полей: причина важнее подробностей.
 */
import { pluralRu } from '../../../shared/pluralRu';
import type { AdminSourceSchedule } from './adminApi';

function waitLabel(minutes: number): string {
  if (minutes < 60) return `через ${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `через ${hours} ч` : `через ${hours} ч ${rest} мин`;
}

export function sourceScheduleLabel(schedule: AdminSourceSchedule): string {
  const when = schedule.due
    ? 'Опрос сейчас'
    : schedule.nextInMin === null
      ? // Срока нет: площадка запрещена и готовой не станет. Выдуманная минута
        // отправила бы администратора ждать того, чего не будет.
        'Опрос не запланирован'
      : `Опрос ${waitLabel(schedule.nextInMin)}`;
  // «Действующий», а не просто «интервал»: в карточке рядом уже стоит
  // настроенный интервал площадки, и адаптированный бывает другим. Два разных
  // числа под одной подписью читаются как ошибка (снимок прода 2026-09-07).
  const parts = [when, `действующий интервал ${schedule.intervalMin} мин`];

  if (schedule.crawlDelaySec !== null) {
    parts.push(`пауза площадки ${schedule.crawlDelaySec} с`);
  }
  if (schedule.robots === 'disallowed') {
    parts.push('robots.txt запрещает');
  }
  if (schedule.hourly >= schedule.hourlyMax) {
    parts.push('часовой бюджет исчерпан');
  }
  if (schedule.failures > 0) {
    parts.push(`${pluralRu(schedule.failures, ['отказ', 'отказа', 'отказов'])} подряд`);
  }

  return parts.join(' · ');
}
