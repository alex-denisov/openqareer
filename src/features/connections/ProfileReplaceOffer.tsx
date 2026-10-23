import { PLATFORM_LABELS, type ConnectionPlatform } from './platformLabels';

export interface ProfileReplaceOfferProps {
  /** The platform that was just connected without importing. */
  readonly platform: 'hh' | 'linkedin';
  readonly busy: boolean;
  readonly onReplace: () => void;
}

const OTHER: Record<'hh' | 'linkedin', ConnectionPlatform> = { hh: 'linkedin', linkedin: 'hh' };

/**
 * One import source per profile (owner, 23.10.2026): a second platform only
 * connects. Replacing the profile with it is a separate, explicit choice.
 */
export function ProfileReplaceOffer({ platform, busy, onReplace }: ProfileReplaceOfferProps) {
  const connected = PLATFORM_LABELS[platform];
  const source = PLATFORM_LABELS[OTHER[platform]];
  return (
    <section className="career-account-card" aria-labelledby="profile-replace-title">
      <div className="career-account-card-header">
        <h3 id="profile-replace-title" className="career-account-card-title">
          {connected} подключён без импорта
        </h3>
      </div>
      <p className="career-account-row-desc">
        Профиль собран из {source} и не изменился. {connected} работает для откликов и
        контактов. Если хотите строить профиль по {connected}, замените его: факты и резюме из{' '}
        {source} уйдут из профиля, исправленные вами факты останутся.
      </p>
      <button type="button" className="career-btn is-sm" disabled={busy} onClick={onReplace}>
        {busy ? 'Заменяем…' : `Заменить профиль данными с ${connected}`}
      </button>
    </section>
  );
}
