import type { ElementType } from 'react';
import {
  Bell,
  Briefcase,
  CalendarDots,
  CheckCircle,
  EnvelopeSimple,
  EnvelopeSimpleOpen,
  Fingerprint,
  LinkedinLogo,
  PaperPlaneTilt,
  Sparkle,
  WarningCircle,
} from '@phosphor-icons/react';
import type { NotificationEventKind } from './notificationsApi';

const ICONS: Record<NotificationEventKind, ElementType> = {
  email_approval: PaperPlaneTilt,
  post_approval: LinkedinLogo,
  interview_reminder: CalendarDots,
  new_vacancies_by_role: Briefcase,
  employer_opened_letter: EnvelopeSimpleOpen,
  consultant_edits: Sparkle,
  footprint_findings: Fingerprint,
  import_completed: CheckCircle,
  employer_reply: EnvelopeSimple,
  delivery_error: WarningCircle,
};

export function NotificationGlyph({ kind }: { readonly kind: NotificationEventKind }) {
  const Icon = ICONS[kind];
  return <Icon className="career-notification-icon" aria-hidden="true" />;
}

export function BellGlyph() {
  const Icon = Bell;
  return <Icon className="career-notification-icon" aria-hidden="true" />;
}
