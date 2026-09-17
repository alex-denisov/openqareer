/**
 * Типы контактов рекрутеров и нанимающих менеджеров (B223).
 *
 * Статусы почты:
 * - 'verified' — подтверждена через пассивный SMTP-рукопожатие или явный проверенный контакт.
 * - 'hypothesis' — рассчитана по паттернам домена компании (first.last, f.last и др.).
 * - 'unverified' — извлечена из текста или публичного источника без прямой валидации.
 */

export type EmailStatus = 'verified' | 'hypothesis' | 'unverified';

export interface RecruiterContact {
  readonly id: string;
  readonly vacancyId: string;
  readonly companyName: string;
  readonly fullName: string;
  readonly roleTitle: string;
  readonly email: string | null;
  readonly emailStatus: EmailStatus;
  readonly phone: string | null;
  readonly telegram: string | null;
  readonly whatsapp: string | null;
  readonly linkedinUrl: string | null;
  readonly githubUrl: string | null;
  readonly twitterUrl: string | null;
  readonly sourceType: string;
  readonly confidence: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RecruiterContactInput {
  readonly id?: string;
  readonly vacancyId: string;
  readonly companyName: string;
  readonly fullName: string;
  readonly roleTitle: string;
  readonly email?: string | null;
  readonly emailStatus?: EmailStatus;
  readonly phone?: string | null;
  readonly telegram?: string | null;
  readonly whatsapp?: string | null;
  readonly linkedinUrl?: string | null;
  readonly githubUrl?: string | null;
  readonly twitterUrl?: string | null;
  readonly sourceType: string;
  readonly confidence: number;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}
