import { deliveryState } from '../../../../../shared/applicationStage';
import type { ApplicationView } from '../../../applications/applicationsApi';
import type { IconName } from '../../kit';

/** Цвет метки стадии: класс `.tag` макета. */
export type TagTone = '' | 'ok' | 'part' | 'miss';

export interface ResponseTag {
  readonly tone: TagTone;
  readonly label: string;
}

/** Кнопка строки: куда ведёт — письмо (o02) или оффер (o06a). */
export interface ResponseRowAction {
  readonly kind: 'letter' | 'offer';
  readonly label: string;
  readonly short: string;
  readonly icon: IconName;
}

export interface ResponseRow {
  readonly id: string;
  readonly role: string;
  readonly company: string;
  readonly tag: ResponseTag;
  /** «Что дальше»: один шаг простыми словами. */
  readonly next: string;
  /** Последнее событие с датой: «приглашение 10.11». */
  readonly event: string;
  /** Столбец «Отклик»: дата отправки или «черновик». */
  readonly sent: string;
  readonly action: ResponseRowAction | null;
  /** Ход за кандидатом. */
  readonly yours: boolean;
  /** Компания молчит дольше срока: можно напомнить о себе. */
  readonly remind: boolean;
  /** Причина, по которой отклик не доставлен. */
  readonly failure: string | null;
  /** Порядок «по сроку действия»: меньше — выше. */
  readonly urgency: number;
  readonly sentAt: number;
}

const MONTHS_SHORT = [
  'янв.', 'февр.', 'марта', 'апр.', 'мая', 'июня', 'июля', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.',
] as const;
const MONTHS_FULL = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
] as const;

function parse(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** «4 нояб.» */
export function shortDate(value: string | null | undefined): string | null {
  const date = parse(value);
  return date ? `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}` : null;
}

/** «14 ноября» */
export function longDate(value: string | null | undefined): string | null {
  const date = parse(value);
  return date ? `${date.getDate()} ${MONTHS_FULL[date.getMonth()]}` : null;
}

/** «3.11» */
export function dotDate(value: string | null | undefined): string | null {
  const date = parse(value);
  return date ? `${date.getDate()}.${String(date.getMonth() + 1).padStart(2, '0')}` : null;
}

export function pluralRu(count: number, forms: readonly [string, string, string]): string {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  if (mod100 > 10 && mod100 < 20) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

function withDate(label: string, date: string | null): string {
  return date ? `${label} ${date}` : label;
}

function failureReason(application: ApplicationView): string | null {
  if (application.stage !== 'applied') return null;
  const receipt = application.deliveryReceipt ?? null;
  if (deliveryState('applied', receipt) !== 'failed') return null;
  const reason = (receipt?.value ?? '').replace(/^\s*не доставлен[оа]?\s*[:.·]?\s*/iu, '').trim();
  return reason || 'причина не указана';
}

function lastPastInterview(application: ApplicationView, now: Date): string | null {
  const past = (application.interviewScheduledAt ?? [])
    .filter((value) => (parse(value)?.getTime() ?? Infinity) <= now.getTime())
    .sort();
  return past.length > 0 ? past[past.length - 1] : null;
}

type Face = Pick<ResponseRow, 'tag' | 'next' | 'event' | 'action' | 'yours' | 'remind' | 'urgency'>;

const LETTER_ACTION: ResponseRowAction = {
  kind: 'letter', label: 'Проверить письмо', short: 'Проверить', icon: 'file',
};
const RESEND_ACTION: ResponseRowAction = {
  kind: 'letter', label: 'Отправить ещё раз', short: 'Повторить', icon: 'send',
};
const OFFER_ACTION: ResponseRowAction = {
  kind: 'offer', label: 'Ответить на оффер', short: 'Ответить', icon: 'send',
};

function appliedFace(application: ApplicationView, failure: string | null): Face {
  if (failure) {
    return {
      tag: { tone: 'miss', label: 'не доставлен' },
      next: 'Отправьте ещё раз',
      event: withDate('не доставлен', dotDate(application.deliveryReceiptRecordedAt)),
      action: RESEND_ACTION,
      yours: true,
      remind: false,
      urgency: 1,
    };
  }
  const urgency = application.followUp?.urgency;
  const sentEvent = withDate(
    application.deliveryReceipt ? 'доставлен' : 'отправлен',
    dotDate(application.deliveryReceiptRecordedAt ?? application.appliedAt),
  );
  if (urgency === 'due' || urgency === 'overdue' || urgency === 'stale') {
    const days = application.followUp?.daysSinceContact ?? 0;
    return {
      tag: { tone: '', label: `молчат ${days} ${pluralRu(days, ['день', 'дня', 'дней'])}` },
      next: 'Письмо-напоминание готово',
      event: sentEvent,
      action: null,
      yours: true,
      remind: true,
      urgency: 4,
    };
  }
  return {
    tag: { tone: '', label: application.deliveryReceipt ? 'доставлен' : 'отправлен' },
    next: 'Ждём ответа',
    event: sentEvent,
    action: null,
    yours: false,
    remind: false,
    urgency: 6,
  };
}

function interviewFace(application: ApplicationView, now: Date): Face {
  const upcoming = application.nearestInterview;
  const invited = withDate('приглашение', dotDate(application.stageChangedAt));
  if (upcoming?.scheduledAt && (parse(upcoming.scheduledAt)?.getTime() ?? 0) > now.getTime()) {
    const ready = upcoming.prepStatus === 'ready';
    return {
      tag: { tone: '', label: withDate('интервью', longDate(upcoming.scheduledAt)) },
      next: ready ? 'Подготовка готова' : 'Подготовьтесь к интервью',
      event: invited,
      action: null,
      yours: !ready,
      remind: false,
      urgency: 3,
    };
  }
  const past = lastPastInterview(application, now);
  if (past) {
    return {
      tag: { tone: 'ok', label: 'интервью прошло' },
      next: 'Расскажите, как прошло',
      event: withDate('интервью', dotDate(past)),
      action: null,
      yours: true,
      remind: false,
      urgency: 2,
    };
  }
  return {
    tag: { tone: '', label: 'интервью' },
    next: 'Уточните дату интервью',
    event: invited,
    action: null,
    yours: true,
    remind: false,
    urgency: 3,
  };
}

function closedFace(application: ApplicationView): Face {
  const closed = application.archiveReason === 'vacancy_closed';
  const base = { action: null, yours: false, remind: false, urgency: 9 } as const;
  if (application.stage === 'rejected') {
    return {
      ...base,
      tag: { tone: '', label: 'отказ' },
      next: 'Отказ получен',
      event: withDate('отказ', dotDate(application.stageChangedAt)),
    };
  }
  return {
    ...base,
    tag: { tone: '', label: closed ? 'вакансия закрыта' : 'в архиве' },
    next: 'Без ответа',
    event: withDate(closed ? 'закрыта' : 'в архиве', dotDate(application.stageChangedAt)),
  };
}

function face(application: ApplicationView, now: Date, failure: string | null): Face {
  switch (application.stage) {
    case 'saved':
      return {
        tag: { tone: 'part', label: 'Черновик' },
        next: 'Проверьте и отправьте',
        event: withDate('черновик сохранён', dotDate(application.updatedAt)),
        action: LETTER_ACTION,
        yours: true,
        remind: false,
        urgency: 0,
      };
    case 'applied':
      return appliedFace(application, failure);
    case 'responded': {
      const mine = application.whoseTurn === 'candidate';
      return {
        tag: { tone: 'ok', label: 'ответили' },
        next: mine ? 'Ответьте компании' : 'Ждём компанию',
        event: withDate('ответ', dotDate(application.stageChangedAt)),
        action: null,
        yours: mine,
        remind: false,
        urgency: mine ? 2 : 5,
      };
    }
    case 'interview':
      return interviewFace(application, now);
    case 'offer': {
      const until = longDate(application.offer?.respondBy);
      return {
        tag: { tone: 'ok', label: 'оффер' },
        next: until ? `Ответить до ${until}` : 'Ответьте на оффер',
        event: withDate('оффер', dotDate(application.stageChangedAt)),
        action: OFFER_ACTION,
        yours: true,
        remind: false,
        urgency: 1,
      };
    }
    default:
      return closedFace(application);
  }
}

/** Строка таблицы «Отклики» из отклика: стадия, «что дальше», событие и действие. */
export function buildResponseRow(application: ApplicationView, now: Date = new Date()): ResponseRow {
  const failure = failureReason(application);
  const vacancy = application.vacancy;
  const sentIso = application.appliedAt ?? application.createdAt;
  const company = vacancy?.company?.trim();
  return {
    id: application.id,
    role: vacancy?.title?.trim() || 'Без названия',
    company: company || (vacancy?.companyHidden ? 'Компания скрыта' : 'Компания не указана'),
    sent: application.stage === 'saved' ? 'черновик' : (shortDate(sentIso) ?? ''),
    sentAt: parse(sentIso)?.getTime() ?? 0,
    failure,
    ...face(application, now, failure),
  };
}
