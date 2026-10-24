import { useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Circle,
  Fingerprint,
  GraduationCap,
  LockKey,
  Translate,
  UsersThree,
} from '@phosphor-icons/react';
import { apiErrorMessage } from '../coach/apiClient';
import { grantRelocationConsent, type RelocationQuestionnaireResponse } from './relocationApi';
import { RelocationHeaderCard } from './RelocationHeaderCard';
import { MobilePush } from './RelocationMobilePush';
import { MobileConsentBody } from './mobile/MobileConsentBody';

export type Consent = RelocationQuestionnaireResponse['consent'];

const PROMISES: readonly { readonly title: string; readonly text: string }[] = [
  {
    title: 'Доступность стран.',
    text: 'По вашему гражданству, диплому и зарплатному полу: что доступно без ограничений, где нужен оффер, где закрыто.',
  },
  {
    title: 'Вакансии с релокацией.',
    text: 'Подборка добавит выбранные страны. Россия останется как есть.',
  },
  {
    title: 'Сравнение и экономика.',
    text: 'Три страны рядом и расчёт свободного остатка после налогов.',
  },
];

const QUESTIONS: readonly {
  readonly icon: ReactNode;
  readonly title: string;
  readonly text: string;
}[] = [
  {
    icon: <Fingerprint aria-hidden="true" size={18} />,
    title: 'Гражданство и документы:',
    text: 'ВНЖ, ПМЖ, визы с датой окончания',
  },
  {
    icon: <GraduationCap aria-hidden="true" size={18} />,
    title: 'Диплом:',
    text: 'страна и признание за рубежом',
  },
  {
    icon: <UsersThree aria-hidden="true" size={18} />,
    title: 'Семья и сроки:',
    text: 'с кем едете, сколько готовы ждать',
  },
  {
    icon: <Translate aria-hidden="true" size={18} />,
    title: 'Языки:',
    text: 'уровни из профиля, местные дополните',
  },
];

export interface RelocationConsentGateProps {
  readonly consentStatus: 'not_granted' | 'revoked';
  readonly consentTextStatus: 'approved' | 'pending_dpo_review';
  readonly mobile: boolean;
  readonly onNavigateBack: () => void;
  readonly onConsentGranted: (consent: Consent) => void;
}

/** Mockup 15 `view=off`: what the section gives, what it asks, consent, «Позже». */
export function RelocationConsentGate(props: RelocationConsentGateProps) {
  if (props.mobile) {
    return (
      <MobilePush
        title="Страны и релокация"
        backLabel="Назад к ролям"
        onBack={props.onNavigateBack}
      >
        <MobileConsentBody {...props} />
      </MobilePush>
    );
  }
  return (
    <div
      className="career-relocation career-relocation-off"
      role="region"
      aria-labelledby="career-relocation-title"
    >
      <RelocationHeaderCard
        title="Страны и релокация"
        status="off"
        description="Сейчас подборка идёт только по России."
        backLabel="Назад к ролям"
        onBack={props.onNavigateBack}
      />
      <ConsentBody {...props} />
    </div>
  );
}

function ConsentBody(props: RelocationConsentGateProps) {
  const revoked = props.consentStatus === 'revoked';
  return (
    <section
      className="career-relocation-card career-relocation-consent"
      aria-labelledby="career-relocation-consent-title"
    >
      {revoked ? <p role="status">Согласие отозвано. Данные анкеты удалены.</p> : null}
      <h3 id="career-relocation-consent-title">Что появится после включения</h3>
      <PromiseList mobile={props.mobile} />
      <h3>Что мы спросим</h3>
      <p className="career-relocation-muted">
        В профиле этих данных пока нет, поэтому сначала короткая анкета, около 5 минут, 4 шага.
        Любое поле можно пропустить.
      </p>
      <QuestionList mobile={props.mobile} />
      <p className="career-relocation-note">
        <LockKey aria-hidden="true" size={17} />
        <span>
          Это чувствительные данные: видите только вы, они хранятся в разделе «Страны и релокация»,
          третьим лицам не передаются. Отзыв согласия удаляет данные анкеты.
        </span>
      </p>
      {props.consentTextStatus === 'approved' ? (
        <ConsentGrantControl onGranted={props.onConsentGranted} onLater={props.onNavigateBack} />
      ) : (
        <ConsentPendingControl onLater={props.onNavigateBack} />
      )}
    </section>
  );
}

function PromiseList({ mobile }: { readonly mobile: boolean }) {
  return (
    <ol className={mobile ? 'career-relocation-group-list' : 'career-relocation-promises'}>
      {PROMISES.map((item, index) => (
        <li key={item.title}>
          {mobile ? null : (
            <span className="career-relocation-step-number" aria-hidden="true">
              {index + 1}
            </span>
          )}
          <span>
            <strong>{item.title}</strong> <span>{item.text}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function QuestionList({ mobile }: { readonly mobile: boolean }) {
  return (
    <ul className={mobile ? 'career-relocation-group-list' : 'career-relocation-questions'}>
      {QUESTIONS.map((item) => (
        <li key={item.title}>
          {item.icon}
          <span>
            <strong>{item.title}</strong> {item.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ConsentGrantControl({
  onGranted,
  onLater,
}: {
  readonly onGranted: (consent: Consent) => void;
  readonly onLater: () => void;
}) {
  const { accepted, setAccepted, busy, error, submit } = useConsentGrant(onGranted);
  return (
    <fieldset className="career-relocation-consent-control" disabled={busy}>
      <label>
        <input
          type="checkbox"
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
        />
        <span>Даю согласие на обработку данных о мобильности для раздела «Страны и релокация»</span>
      </label>
      <div className="career-relocation-footer-actions">
        <button
          className="career-relocation-btn is-primary"
          type="button"
          disabled={!accepted || busy}
          onClick={() => void submit()}
        >
          <ArrowRight aria-hidden="true" size={17} />
          Заполнить анкету
        </button>
        <button className="career-relocation-btn" type="button" onClick={onLater}>
          Позже
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </fieldset>
  );
}

/** Accept the mobility consent: one request, a readable error, no double submit. */
export function useConsentGrant(onGranted: (consent: Consent) => void) {
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      onGranted((await grantRelocationConsent()).consent);
    } catch (reason) {
      setError(apiErrorMessage(reason, 'Не удалось сохранить согласие. Повторите.'));
    } finally {
      setBusy(false);
    }
  };
  return { accepted, setAccepted, busy, error, submit };
}

function ConsentPendingControl({ onLater }: { readonly onLater: () => void }) {
  return (
    <fieldset className="career-relocation-consent-control">
      <label>
        <input type="checkbox" checked={false} disabled readOnly />
        <span>Текст согласия ожидает проверки и пока не может быть принят.</span>
      </label>
      <div className="career-relocation-footer-actions">
        <button className="career-relocation-btn is-primary" type="button" disabled>
          <ArrowRight aria-hidden="true" size={17} />
          Заполнить анкету
        </button>
        <button className="career-relocation-btn" type="button" onClick={onLater}>
          Позже
        </button>
      </div>
      <p className="career-relocation-muted">
        <Circle aria-hidden="true" size={10} /> Заполнение станет доступно после утверждения текста
        согласия.
      </p>
    </fieldset>
  );
}
