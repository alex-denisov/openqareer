import type { ReactNode } from 'react';
import {
  ArrowRight,
  Briefcase,
  Fingerprint,
  Globe,
  GraduationCap,
  LockKey,
  Scales,
  Translate,
  UsersThree,
} from '@phosphor-icons/react';
import { useConsentGrant, type RelocationConsentGateProps } from '../RelocationConsentGate';

interface GroupRow {
  readonly icon: ReactNode;
  readonly title: string;
  readonly text?: string;
}

const PROMISE_ROWS: readonly GroupRow[] = [
  {
    icon: <Globe aria-hidden="true" size={18} />,
    title: 'Доступность стран',
    text: 'по гражданству, диплому и зарплатному полу',
  },
  {
    icon: <Briefcase aria-hidden="true" size={18} />,
    title: 'Вакансии с релокацией',
    text: 'Россия останется как есть',
  },
  {
    icon: <Scales aria-hidden="true" size={18} />,
    title: 'Сравнение и экономика',
    text: 'три страны рядом и остаток после налогов',
  },
];

const QUESTION_ROWS: readonly GroupRow[] = [
  {
    icon: <Fingerprint aria-hidden="true" size={18} />,
    title: 'Гражданство и документы',
    text: 'ВНЖ, ПМЖ, визы с датой окончания',
  },
  {
    icon: <GraduationCap aria-hidden="true" size={18} />,
    title: 'Диплом',
    text: 'страна и признание за рубежом',
  },
  { icon: <UsersThree aria-hidden="true" size={18} />, title: 'Семья и сроки' },
  { icon: <Translate aria-hidden="true" size={18} />, title: 'Языки' },
];

/** Mockup 15 `view=off` at 390: large title, two grouped lists, the note, a consent switch, one CTA. */
export function MobileConsentBody(props: RelocationConsentGateProps) {
  return (
    <section className="career-relocation-mobile-off" aria-labelledby="career-relocation-off-title">
      <header className="career-relocation-mobile-hero">
        <h2 id="career-relocation-off-title">Страны и релокация</h2>
        <p>Сейчас подборка идёт только по России.</p>
      </header>
      {props.consentStatus === 'revoked' ? (
        <p className="career-relocation-mobile-foot" role="status">
          Согласие отозвано. Данные анкеты удалены.
        </p>
      ) : null}
      <GroupList caption="Что появится после включения" rows={PROMISE_ROWS} />
      <div className="career-relocation-mobile-group">
        <GroupList caption="Что мы спросим" rows={QUESTION_ROWS} />
        <p className="career-relocation-mobile-foot">
          Около 5 минут, 4 шага, любое поле можно пропустить.
        </p>
      </div>
      <p className="career-relocation-mobile-note">
        <LockKey aria-hidden="true" size={16} />
        <span>
          Это чувствительные данные: видите только вы, третьим лицам они не передаются. Отзыв
          согласия удаляет данные анкеты.
        </span>
      </p>
      <ConsentSwitch
        approved={props.consentTextStatus === 'approved'}
        onGranted={props.onConsentGranted}
      />
    </section>
  );
}

/** The consent switch and the one CTA that saves it. */
function ConsentSwitch({
  approved,
  onGranted,
}: {
  readonly approved: boolean;
  readonly onGranted: RelocationConsentGateProps['onConsentGranted'];
}) {
  const { accepted, setAccepted, busy, error, submit } = useConsentGrant(onGranted);
  return (
    <>
      <label className="career-relocation-mobile-switch">
        <span>
          {approved
            ? 'Согласие на обработку данных о мобильности'
            : 'Текст согласия ожидает проверки и пока не может быть принят'}
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={accepted}
          disabled={!approved || busy}
          onChange={(event) => setAccepted(event.target.checked)}
        />
      </label>
      <button
        className="career-relocation-mobile-cta"
        type="button"
        disabled={!approved || !accepted || busy}
        onClick={() => void submit()}
      >
        <ArrowRight aria-hidden="true" size={18} />
        Заполнить анкету
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}

function GroupList({
  caption,
  rows,
}: {
  readonly caption: string;
  readonly rows: readonly GroupRow[];
}) {
  return (
    <div className="career-relocation-mobile-group">
      <h3 className="career-relocation-mobile-cap">{caption}</h3>
      <ul className="career-relocation-mobile-rows">
        {rows.map((row) => (
          <li key={row.title}>
            <span className="career-relocation-mobile-action-icon">{row.icon}</span>
            <span>
              <b>{row.title}</b>
              {row.text ? <small>{row.text}</small> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
