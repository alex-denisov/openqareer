import type { CareerStrategy, StrategyVersion } from '../../../shared/careerStrategy';
import { pluralRu } from '../../../shared/pluralRu';

/**
 * Как «Стратегия» читается кандидату (B180, срез 2).
 *
 * Логика вынесена из компонента, потому что честность здесь проверяется
 * тестами построчно: версия, дата, кто назвал роль и что сказал пул в момент
 * выбора. Ни одна строка не додумывает того, чего в версии нет.
 */
export interface StrategyView {
  readonly title: string;
  readonly versionLine: string;
  readonly originLine: string;
  readonly confirmationLine: string;
  readonly constraintsLine: string;
  readonly reasonLine: string | null;
  readonly history: readonly string[];
}

export function describeStrategy(strategy: CareerStrategy): StrategyView {
  const version = strategy.current;
  return {
    title: version.role.title,
    versionLine: `версия ${version.version} от ${formatDay(version.decidedAt)}`,
    originLine: originLine(version),
    confirmationLine: confirmationLine(version),
    constraintsLine: constraintsLine(version),
    // Первую версию менять было не с чего, и причина у неё служебная.
    reasonLine: version.version > 1 ? `Причина смены: ${version.reason}` : null,
    history: strategy.history.map(
      (entry) =>
        `версия ${entry.version} · ${entry.role.title} · ${formatDay(entry.decidedAt)} · ${entry.reason}`,
    ),
  };
}

/** Роль, названная моделью, рынком и кандидатом — три разных факта. */
function originLine(version: StrategyVersion): string {
  if (version.role.origin === 'candidate') return 'Роль назвали вы сами.';
  const who =
    version.role.origin === 'market'
      ? 'Так эту роль называют в вакансиях пула'
      : 'Название предложила модель по фактам вашего резюме';
  const reason = version.role.reason ? `: ${version.role.reason}` : '.';
  return `${who}${reason}`;
}

/**
 * Подтверждение — снимок момента выбора, и строка обязана это называть: пул к
 * следующему входу другой, а версия помнит тот.
 */
function confirmationLine(version: StrategyVersion): string {
  const { confirmation } = version.role;
  const day = formatDay(version.decidedAt);
  if (confirmation.state === 'not-found') {
    return `На ${day} вакансий по этой роли в собранном пуле не было (пул: ${version.provenance.poolSize}).`;
  }
  if (confirmation.state === 'too-few') {
    return `На ${day} найдено ${confirmation.sampleSize} — рано делать выводы, нужна выборка от восьми.`;
  }
  return `На ${day} ${pluralRu(confirmation.sampleSize, [
    'вакансия',
    'вакансии',
    'вакансий',
  ])} · наблюдение ${observationWindow(confirmation)}.`;
}

/** Пустой список рынков означает «ещё не сказал», а не «ищу везде». */
function constraintsLine(version: StrategyVersion): string {
  const regions = version.constraints.regions;
  const markets =
    regions.length > 0
      ? `рынки: ${regions.join(', ')}`
      : 'рынки не названы — кампания их не сузит';
  const note = version.constraints.note ? ` · ваши ограничения: ${version.constraints.note}` : '';
  return `${markets}${note}`;
}

function observationWindow(confirmation: {
  observedFrom?: string;
  observedTo?: string;
}): string {
  if (!confirmation.observedFrom || !confirmation.observedTo) return 'даты не сохранены';
  const from = formatDay(confirmation.observedFrom);
  const to = formatDay(confirmation.observedTo);
  return from === to ? to : `${from} — ${to}`;
}

/**
 * Смена роли обнуляет воронку, поэтому причина обязательна — но только смена:
 * первый выбор менять нечего.
 */
export function strategyChangeNeedsReason(
  strategy: CareerStrategy | null,
  title: string,
): boolean {
  if (!strategy) return false;
  return strategy.current.role.title.trim().toLowerCase() !== title.trim().toLowerCase();
}

function formatDay(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(
    new Date(value),
  );
}

/**
 * Что кампания «Поиск» говорит о своём направлении (B180, срез 2).
 *
 * Кампания читает роль из стратегии, а не из свободной строки мастера: строку
 * никто не датировал и не объяснял, а версия несёт и дату, и причину. Пока
 * стратегии нет, строка мастера остаётся — но названа тем, чем является.
 */
export function campaignRoleLine(
  strategy: CareerStrategy | null,
  targetDirection: string,
): string {
  if (strategy) {
    const { current } = strategy;
    return `Роль «${current.role.title}» · версия ${current.version} от ${formatDay(
      current.decidedAt,
    )}`;
  }
  const direction = targetDirection.trim();
  return direction
    ? `Направление «${direction}»`
    : 'Роль не выбрана — подбор идёт по подтверждённым фактам';
}
