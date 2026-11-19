/**
 * B698: сообщение знакомому или рекрутёру из приложения. Платформа ничего не отправляет:
 * готовит текст, кандидат правит и одобряет, клиент копирует его и открывает профиль
 * получателя, кандидат отмечает «Отправил». Почта и телефон получателя в ответ не попадают.
 */
export const B640_CONTACT_MESSAGE_KINDS = ['known_contact', 'ask_introduction', 'recruiter'] as const;
export type B640ContactMessageKind = (typeof B640_CONTACT_MESSAGE_KINDS)[number];
/** Черновик от модели не длиннее; правка кандидата — до `B640_CONTACT_MESSAGE_EDIT_MAX`. */
export const B640_CONTACT_MESSAGE_DRAFT_MAX = 600;
export const B640_CONTACT_MESSAGE_EDIT_MAX = 2000;
export const B640_CONTACT_MESSAGE_LIST_MAX = 10;
export const B640_CONTACT_MESSAGE_STATES = ['draft', 'approved', 'sent'] as const;
export type B640ContactMessageState = (typeof B640_CONTACT_MESSAGE_STATES)[number];

export interface B640ContactMessageRecipient {
  readonly name: string;
  readonly linkedinUrl: string | null;
}

/** `POST /api/v1/candidate/b640/contact-messages`, `PUT .../:id`, `GET ...?contactId=`: `data`. */
export interface B640ContactMessage {
  readonly id: string;
  readonly kind: B640ContactMessageKind;
  readonly text: string;
  readonly recipient: B640ContactMessageRecipient;
  readonly createdAt: string;
}

/** `POST .../:id/approve`: `data`. `openUrl` — только https linkedin.com, иначе null. */
export interface B640ContactMessageApproval extends B640ContactMessage {
  readonly state: 'approved';
  readonly approvedAt: string;
  readonly openUrl: string | null;
}

/** `POST .../:id/sent`: `data`. */
export interface B640ContactMessageSent extends B640ContactMessage {
  readonly state: 'sent';
  readonly sentAt: string;
}
