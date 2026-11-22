import { z } from 'zod';

/**
 * B732: у openqareer один бот и один вебхук. Чат SMM владельца — обработчику SMM,
 * `/start <код>` из другого чата — привязке уведомлений, остальное — кандидату.
 */
export type TelegramUpdateRoute = 'smm' | 'link' | 'candidate';

export const TELEGRAM_LINK_START = /^\/start(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]{40,64})$/u;

const chatSchema = z.object({ id: z.union([z.number(), z.string()]) });
const routedUpdateSchema = z.object({
  message: z.object({ chat: chatSchema, text: z.string().optional() }).passthrough().optional(),
  callback_query: z
    .object({ message: z.object({ chat: chatSchema }).passthrough().optional() })
    .passthrough()
    .optional(),
});

export function telegramUpdateRoute(body: unknown, smmChatId: string | null): TelegramUpdateRoute {
  const update = routedUpdateSchema.safeParse(body);
  if (!update.success) return 'candidate';
  const chat = update.data.message?.chat ?? update.data.callback_query?.message?.chat;
  if (smmChatId && chat && String(chat.id) === smmChatId) return 'smm';
  const text = update.data.message?.text;
  return text && TELEGRAM_LINK_START.test(text) ? 'link' : 'candidate';
}
