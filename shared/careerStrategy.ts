/**
 * «Стратегия» — выбранная роль как версионированный объект (B180, срез 2).
 *
 * До этого среза выбранного направления не существовало вовсе: кампания
 * «Поиск» читала свободную строку мастера (`targetDirection`), которую никто
 * не датировал и не объяснял. Роль, названная моделью и проверенная пулом,
 * никуда не сохранялась — панель показывала её и забывала.
 *
 * Три требования, из которых собран этот модуль:
 *
 * 1. **Версия, а не поле.** Смена роли обнуляет воронку и уничтожает
 *    сравнимость накопленных данных, поэтому прежняя гипотеза сохраняется как
 *    альтернатива с её данными, а не удаляется.
 * 2. **Причина обязательна.** Менять стратегию молча нельзя: кандидат обязан
 *    увидеть, что изменилось и какое наблюдение это вызвало.
 * 3. **Снимок, а не ссылка.** Пул меняется каждый час; версия помнит, что
 *    рынок говорил о роли в момент выбора, вместе с размером пула и ступенью,
 *    назвавшей роль.
 */

import type { ProposedRole, RoleConfirmation } from './roleProposals';

/** Что пул говорил о роли в момент выбора — снимок, а не ссылка на пул. */
export interface StrategyRoleConfirmation {
  readonly state: 'observed' | 'too-few' | 'not-found';
  readonly sampleSize: number;
  readonly observedFrom?: string;
  readonly observedTo?: string;
}

export interface StrategyRole {
  readonly title: string;
  /**
   * Откуда взялось имя. `candidate` — кандидат назвал роль сам: это законный
   * вход, а не ошибка, и обесценивать его нельзя.
   */
  readonly origin: 'model' | 'market' | 'candidate';
  readonly reason: string | null;
  readonly evidenceRefs: readonly string[];
  readonly confirmation: StrategyRoleConfirmation;
}

/**
 * Жёсткие ограничения кампании — только то, что кандидат действительно сказал.
 *
 * Право на работу, языки и лицензии продукт пока не спрашивает, и выдумывать
 * их здесь нельзя: пустое поле честнее придуманного.
 */
export interface StrategyConstraints {
  /** Рынки поиска; пустой список означает «ещё не сказал», а не «везде». */
  readonly regions: readonly string[];
  /** Дословно то, что кандидат написал об ограничениях. Код это не разбирает. */
  readonly note: string | null;
}

/** Кто назвал роль и на каком пуле это происходило. */
export interface StrategyProvenance {
  /** Ступень очереди называния; `null` — роль назвал сам кандидат. */
  readonly namedBy: string | null;
  readonly language: string | null;
  /** Размер пула на момент выбора: без него число вакансий не читается. */
  readonly poolSize: number;
}

export interface StrategyVersion {
  readonly version: number;
  readonly role: StrategyRole;
  readonly constraints: StrategyConstraints;
  readonly reason: string;
  readonly decidedAt: string;
  readonly provenance: StrategyProvenance;
}

export interface CareerStrategy {
  readonly current: StrategyVersion;
  /** Прежние версии, свежая впереди. */
  readonly history: readonly StrategyVersion[];
}

export type ChooseStrategyResult =
  | { readonly ok: true; readonly strategy: CareerStrategy }
  | { readonly ok: false; readonly error: 'reason_required' };

/** Первая версия причины не требует: менять ещё нечего. */
const FIRST_CHOICE_REASON = 'Первый выбор роли';

export function chooseStrategyRole(input: {
  readonly previous: CareerStrategy | null;
  readonly role: StrategyRole;
  readonly constraints: StrategyConstraints;
  readonly reason: string | null;
  readonly decidedAt: string;
  readonly provenance: StrategyProvenance;
}): ChooseStrategyResult {
  const title = input.role.title.trim();
  const previous = input.previous;

  if (previous && sameRole(previous.current.role.title, title)) {
    // Тот же выбор — не решение: плодить версии на повторном нажатии значит
    // превращать историю решений в журнал кликов.
    return { ok: true, strategy: previous };
  }

  const reason = (input.reason ?? '').trim();
  if (previous && reason.length === 0) return { ok: false, error: 'reason_required' };

  const version: StrategyVersion = {
    version: (previous?.current.version ?? 0) + 1,
    role: { ...input.role, title },
    constraints: input.constraints,
    reason: previous ? reason : FIRST_CHOICE_REASON,
    decidedAt: input.decidedAt,
    provenance: input.provenance,
  };

  return {
    ok: true,
    strategy: {
      current: version,
      history: previous ? [previous.current, ...previous.history] : [],
    },
  };
}

function sameRole(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/** Выбранное предложение становится снимком: пул к следующему входу другой. */
export function strategyRoleFromProposal(proposal: ProposedRole): StrategyRole {
  return {
    title: proposal.title,
    origin: proposal.origin,
    reason: proposal.reason,
    evidenceRefs: proposal.evidenceRefs,
    confirmation: snapshotConfirmation(proposal.confirmation),
  };
}

/**
 * Роль, названная самим кандидатом.
 *
 * Это законный вход, а не ошибка: кандидат вправе назвать роль, которой нет ни
 * в предложениях модели, ни в пуле. Пул при этом всё равно спрашивают — просто
 * его ответом может быть «не найдено».
 */
export function candidateNamedStrategyRole(
  title: string,
  confirmation: RoleConfirmation,
): StrategyRole {
  return {
    title: title.trim(),
    origin: 'candidate',
    reason: null,
    evidenceRefs: [],
    confirmation: snapshotConfirmation(confirmation),
  };
}

function snapshotConfirmation(confirmation: RoleConfirmation): StrategyRoleConfirmation {
  if (confirmation.state === 'not-found') return { state: 'not-found', sampleSize: 0 };
  if (confirmation.state === 'too-few') {
    return { state: 'too-few', sampleSize: confirmation.sampleSize };
  }
  return {
    state: 'observed',
    sampleSize: confirmation.sampleSize,
    observedFrom: confirmation.observedFrom,
    observedTo: confirmation.observedTo,
  };
}
