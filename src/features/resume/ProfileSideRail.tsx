import {
  CheckCircle,
  EnvelopeSimple,
  Globe,
  PaperPlaneTilt,
  Phone,
  PlugsConnected,
} from '@phosphor-icons/react';
import { resumeSourceCoverage, type ImportedSource } from './resumeSourceCoverage';
import type { ResumeDraft } from './resumeTypes';

function SourceCoveragePanel({
  draft,
  importedSource,
  onOpenConnections,
}: {
  readonly draft: ResumeDraft;
  readonly importedSource?: ImportedSource;
  readonly onOpenConnections?: () => void;
}) {
  const coverage = resumeSourceCoverage(draft);
  const total = coverage.filled.length + coverage.empty.length;
  return (
    <div className="career-profile-screen-panel career-profile-screen-rail-card">
      <h2>
        <CheckCircle size={15} />
        Источник профиля
      </h2>
      <p className="career-profile-screen-rail-hint">
        {importedSource
          ? `Импортировано из ${importedSource.label} · заполнено разделов: ${coverage.filled.length} из ${total}.`
          : `Заполнено разделов: ${coverage.filled.length} из ${total}.`}
      </p>
      <ul className="career-profile-screen-coverage">
        {coverage.filled.map((section) => (
          <li key={section.id}>
            <span>{section.label}</span>
            <span>заполнено</span>
          </li>
        ))}
        {coverage.empty.map((section) => (
          <li key={section.id} className="is-missing">
            <span>{section.label}</span>
            <span>не заполнено</span>
          </li>
        ))}
      </ul>
      {/* A re-import is a new read of the source, which lives in the
          account's connections; this card only re-read the server (B266). */}
      {onOpenConnections ? (
        <button type="button" className="career-quiet-button" onClick={onOpenConnections}>
          <PlugsConnected size={14} />
          Импорт и подключения
        </button>
      ) : null}
    </div>
  );
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

export function ProfileSideRail({
  draft,
  importedSource,
  onOpenConnections,
}: {
  readonly draft: ResumeDraft;
  readonly importedSource?: ImportedSource;
  readonly onOpenConnections?: () => void;
}) {
  return (
    <aside className="career-profile-screen-side-col" aria-label="Источник и контакты">
      <SourceCoveragePanel
        draft={draft}
        importedSource={importedSource}
        onOpenConnections={onOpenConnections}
      />
      <ContactsPanel draft={draft} />
    </aside>
  );
}
