import {
  ArrowRight,
  CheckCircle,
  EnvelopeSimple,
  Eye,
  Globe,
  PaperPlaneTilt,
  Phone,
} from '@phosphor-icons/react';
import type { ResumeDraft } from './resumeTypes';
import { WorkPreferencesPanel } from '../cabinet/WorkPreferencesPanel';
import { useWorkPreferences } from '../cabinet/useWorkPreferences';
import type { RelocationQuestionnaireResponse } from '../relocation/relocationApi';

export type ProfileRelocationSummaryStatus =
  'loading' | 'enabled' | 'prepared' | 'not_enabled' | 'unknown';

export function profileRelocationSummaryStatusFromResponse(
  response: RelocationQuestionnaireResponse,
): ProfileRelocationSummaryStatus {
  if (response.consent.granted) return 'enabled';
  if (response.consent.status === 'revoked') return 'not_enabled';
  if (response.consentTextStatus === 'pending_dpo_review') return 'prepared';
  return 'not_enabled';
}

export function profileRelocationSummaryLabel(status: ProfileRelocationSummaryStatus): string {
  if (status === 'enabled') return 'Включено';
  if (status === 'prepared') return 'Подготовлено';
  if (status === 'not_enabled') return 'Не включено';
  if (status === 'loading') return 'Проверяем статус…';
  return 'Статус неизвестен';
}

export function profileRelocationSummaryDetail(status: ProfileRelocationSummaryStatus): string {
  if (status === 'enabled') return 'Данные о переезде доступны только вам.';
  if (status === 'prepared') return 'Согласие ожидает проверки и пока не может быть принято.';
  if (status === 'not_enabled') return 'Согласие отозвано или ещё не выдано.';
  if (status === 'loading') return 'Проверяем согласие и данные о переезде.';
  return 'Не удалось загрузить статус релокации.';
}

function ContactsPanel({ draft }: { readonly draft: ResumeDraft }) {
  const contact = draft.candidate.contact;
  const items: { icon: typeof EnvelopeSimple; text: string }[] = [];
  if (contact?.email) items.push({ icon: EnvelopeSimple, text: contact.email });
  if (contact?.phone) items.push({ icon: Phone, text: contact.phone });
  if (contact?.telegram) items.push({ icon: PaperPlaneTilt, text: contact.telegram });
  if (contact?.links?.[0]) items.push({ icon: Globe, text: contact.links[0] });
  if (!items.length) return null;
  return (
    <div className="career-profile-screen-panel career-profile-screen-rail-card">
      <h2>
        <EnvelopeSimple size={15} />
        Контакты
      </h2>
      <ul className="career-profile-screen-rail-contacts">
        {items.map((item) => (
          <li key={item.text}>
            <item.icon size={15} />
            {item.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WorkPreferencesRailPanel() {
  const state = useWorkPreferences();
  return <WorkPreferencesPanel state={state} />;
}

function RelocationHead({
  summary,
  onOpen,
}: {
  readonly summary: ProfileRelocationSummaryStatus;
  readonly onOpen?: () => void;
}) {
  return (
    <div className="career-profile-screen-relocation-head">
      <h2 id="career-profile-screen-relocation-title">Релокация</h2>
      <span className={`career-profile-screen-tag${summary === 'enabled' ? ' is-verified' : ''}`}>
        {summary === 'enabled' ? <CheckCircle size={14} aria-hidden="true" /> : null}
        {profileRelocationSummaryLabel(summary)}
      </span>
      <span className="career-profile-screen-tag">
        <Eye size={14} aria-hidden="true" />
        Видите только вы
      </span>
      {onOpen ? (
        <button type="button" className="career-secondary-button career-btn-sm" onClick={onOpen}>
          <ArrowRight size={16} aria-hidden="true" />
          <span>Открыть</span>
        </button>
      ) : null}
    </div>
  );
}

interface ProfileSideRailProps {
  readonly draft: ResumeDraft;
  readonly desktopLayout?: boolean;
  readonly onOpenRelocation?: () => void;
  readonly relocationSummary?: ProfileRelocationSummaryStatus;
}

export function ProfileSideRail({
  draft,
  desktopLayout = false,
  onOpenRelocation,
  relocationSummary = 'unknown',
}: ProfileSideRailProps) {
  if (desktopLayout) {
    return (
      <section
        id="sec-relocation"
        className="career-profile-screen-panel career-profile-screen-relocation"
        aria-labelledby="career-profile-screen-relocation-title"
      >
        <RelocationHead summary={relocationSummary} onOpen={onOpenRelocation} />
        <p className="career-profile-screen-relocation-summary">
          {profileRelocationSummaryDetail(relocationSummary)}
        </p>
        <p className="career-profile-screen-quality-note">
          Документы, образование и сроки хранятся в разделе «Страны и релокация», вкладка «Мои
          данные». Здесь только сводка.
        </p>
        <details className="career-profile-screen-relocation-prefs">
          <summary>Ограничения и предпочтения для подбора</summary>
          <WorkPreferencesRailPanel />
        </details>
      </section>
    );
  }

  return (
    <aside
      id="sec-relocation"
      className="career-profile-screen-side-col"
      aria-label="Контакты и ограничения"
    >
      <ContactsPanel draft={draft} />
      <WorkPreferencesRailPanel />
    </aside>
  );
}
