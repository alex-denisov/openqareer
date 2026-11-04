/**
 * Потолки ступени Vertex в механиках, где кандидат ждёт ответ (решение владельца 04.11:
 * Vertex первым, пока идёт стартовый кредит). Ступень, не уложившаяся в потолок, уступает ход
 * следующей в том же ходе. Значения выведены из бюджетов самих механик:
 *  - квиз: тот же класс вывода, что у ролей кампании (25 с, `campaignRoleModel`);
 *  - пункты резюме: следующая ступень (luna) отвечает за 36–43 с (замер 29.10), Vertex ей уступает 30 с.
 */
export const VERTEX_CHAT_TIMEOUTS_MS = {
  skillQuizzes: 25_000,
  experienceBullets: 30_000,
} as const;

export type VertexChatMechanic = keyof typeof VERTEX_CHAT_TIMEOUTS_MS;
