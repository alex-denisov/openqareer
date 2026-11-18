import { getAccountCapabilityConsents } from '../../account/accountCapabilityConsentApi';
import { getNotificationPreferences } from '../../account/notificationPreferencesApi';
import { getAccount, getConnections } from '../../coach/coachApi';
import { useCandidateMediaSrc } from '../../resume/candidateMediaSrc';
import { getResumeStudio } from '../../resume/resumeApi';
import { getCandidateBillingSummary } from '../../shell/candidateBillingApi';
import { Icon } from '../kit/Icon';
import { buildNodePath, type B640Node } from '../routes';
import { Link } from '../shell/Link';
import { useShell } from '../shell/ShellContext';
import {
  connectionsSummary,
  consentsSummary,
  notificationsSummary,
  securitySummary,
} from './model';
import { useLoad } from './parts';

const PLAN_NAME = { free: 'Free', basic: 'Basic', pro: 'Pro', max: 'Max' } as const;

/** Подписи под разделами: что прочиталось, то и показано; сбой одного чтения остальных не трогает. */
interface Summaries {
  readonly security: string | null;
  readonly connections: string | null;
  readonly notifications: string | null;
  readonly consents: string | null;
  readonly plan: string | null;
  /** Фото из профиля; `null` — фото нет или профиль не прочитался. */
  readonly photoMediaId: string | null;
}

const valueOf = <T,>(result: PromiseSettledResult<T>): T | null =>
  result.status === 'fulfilled' ? result.value : null;

async function loadSummaries(): Promise<Summaries> {
  const [account, connections, preferences, consents, billing, profile] = await Promise.allSettled([
    getAccount(),
    getConnections(),
    getNotificationPreferences(),
    getAccountCapabilityConsents(),
    getCandidateBillingSummary(),
    getResumeStudio(),
  ]);
  const sessions = valueOf(account)?.sessions;
  const links = valueOf(connections);
  const events = valueOf(preferences);
  const granted = valueOf(consents)?.filter((item) => item.revokedAt === null);
  const plan = valueOf(billing)?.currentPlan;
  return {
    security: sessions ? securitySummary(sessions.length) : null,
    connections: links ? connectionsSummary(links) : null,
    notifications: events ? notificationsSummary(events) : null,
    consents: granted ? consentsSummary(granted.length) : null,
    plan: plan ? PLAN_NAME[plan] : null,
    photoMediaId: valueOf(profile)?.draft?.candidate.photoMediaId ?? null,
  };
}

function SectionRow({ code, title, value }: { code: string; title: string; value: string | null }) {
  return (
    <li className="set-row">
      <div className="set-l">
        <Link className="set-t set-a" to={buildNodePath(code)}>
          {title}
        </Link>
        {value ? <span className="set-v">{value}</span> : null}
      </div>
      <div className="set-r">
        <Icon name="right" />
      </div>
    </li>
  );
}

/** Фото кандидата из профиля; фото нет — первая буква имени. */
function Photo({ mediaId, name }: { readonly mediaId: string | null; readonly name: string }) {
  const src = useCandidateMediaSrc(mediaId ?? undefined);
  if (src) return <img className="phead-photo" src={src} alt="" width={72} height={72} />;
  return (
    <span className="phead-ini" aria-hidden="true">
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** n00 «Аккаунт»: разделы списком (на 390 — вход в аккаунт вместо вкладок). */
export function SectionsScreen({ node }: { readonly node: B640Node }) {
  const { session } = useShell();
  const load = useLoad(loadSummaries);
  const summaries = load.state === 'ready' ? load.data : null;
  const name = session.displayName ?? session.username;
  return (
    <div
      className="page set-page"
      data-b640-node={node.code}
      data-b640-section={node.section}
      aria-busy={load.state === 'loading' || undefined}
    >
      <section className="lead" aria-labelledby="b640-account-name">
        <div className="acc-photo">
          <Photo mediaId={summaries?.photoMediaId ?? null} name={name} />
          <div>
            <h2 className="lead-title" id="b640-account-name">
              {name}
            </h2>
            {session.email ? <p className="mod-text">{session.email}</p> : null}
          </div>
        </div>
      </section>
      <section className="set-group" aria-label="Разделы аккаунта">
        <ul className="set-list">
          <SectionRow code="n04" title="Вход и безопасность" value={summaries?.security ?? null} />
          <SectionRow code="n03" title="Подключения" value={summaries?.connections ?? null} />
          <SectionRow code="n02" title="Уведомления" value={summaries?.notifications ?? null} />
          <SectionRow code="n05" title="Согласия и данные" value={summaries?.consents ?? null} />
          <SectionRow code="n06" title="Приложение" value="Тема и часовой пояс" />
          <SectionRow code="t03" title="Подписка и платежи" value={summaries?.plan ?? null} />
        </ul>
      </section>
    </div>
  );
}
