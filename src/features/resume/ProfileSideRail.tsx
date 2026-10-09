import { EnvelopeSimple, Globe, PaperPlaneTilt, Phone } from '@phosphor-icons/react';
import type { ResumeDraft } from './resumeTypes';
import { WorkPreferencesPanel } from '../cabinet/WorkPreferencesPanel';
import { useWorkPreferences } from '../cabinet/useWorkPreferences';

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

function WorkPreferencesRailPanel() {
  const state = useWorkPreferences();
  return <WorkPreferencesPanel state={state} />;
}

export function ProfileSideRail({ draft }: { readonly draft: ResumeDraft }) {
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
