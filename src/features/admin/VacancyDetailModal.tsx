import React, { useEffect, useState } from 'react';
import { getAdminVacancy, type AdminVacancy } from './adminApi';

function formatSalary(salary?: AdminVacancy['salary']): string {
  if (!salary) return 'Зарплата не указана';
  const parts: string[] = [];
  if (salary.from) parts.push(`от ${salary.from.toLocaleString()}`);
  if (salary.to) parts.push(`до ${salary.to.toLocaleString()}`);
  parts.push(salary.currency);
  if (salary.gross) parts.push('(до вычета)');
  return parts.join(' ');
}

// ---------- Diagnostic Bar ----------

function DiagnosticItem({ label, val, onCopy, copied }: { label: string; val: string; onCopy?: () => void; copied?: boolean }) {
  return (
    <div className="admin-diag-item">
      <span className="admin-diag-item__label">{label}:</span>
      <code className="admin-diag-item__code">{val}</code>
      {onCopy && (
        <button type="button" className="admin-btn admin-btn--ghost admin-btn--tiny" onClick={onCopy}>
          {copied ? '✓ Скопировано' : '📋'}
        </button>
      )}
    </div>
  );
}

function VacancyDiagnosticBar({ vacancy }: { vacancy: AdminVacancy }) {
  const [copiedId, setCopiedId] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const copyId = () => {
    void navigator.clipboard.writeText(vacancy.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const copyUrl = () => {
    void navigator.clipboard.writeText(vacancy.url);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  return (
    <aside className="admin-diag-bar" aria-label="Диагностика вакансии">
      <div className="admin-diag-bar__grid">
        <DiagnosticItem label="ID Вакансии" val={vacancy.id} onCopy={copyId} copied={copiedId} />
        <DiagnosticItem label="Источник" val={`${vacancy.provenance.sourceId} (${vacancy.provenance.sourceType})`} />
        {vacancy.provenance.channelName && (
          <DiagnosticItem label="Канал / Группа" val={`@${vacancy.provenance.channelName}`} />
        )}
        <DiagnosticItem label="Fingerprint" val={vacancy.fingerprint.slice(0, 14)} />
        <DiagnosticItem label="URL" val={vacancy.url.length > 35 ? `${vacancy.url.slice(0, 35)}…` : vacancy.url} onCopy={copyUrl} copied={copiedUrl} />
      </div>
    </aside>
  );
}

// ---------- Header Section ----------

function VacancyHeaderBadges({ vacancy }: { vacancy: AdminVacancy }) {
  return (
    <div className="admin-vacancy-header-badges">
      <span className="admin-company-pill">{vacancy.company}</span>
      <span className="admin-dot-sep">•</span>
      <span className="admin-location-pill">{vacancy.location}</span>
      {vacancy.isRemote && <span className="admin-badge admin-badge--pro">Remote</span>}
      {vacancy.experienceLevel && <span className="admin-badge admin-badge--info">{vacancy.experienceLevel}</span>}
      {vacancy.employmentType && <span className="admin-badge admin-badge--subtle">{vacancy.employmentType}</span>}
    </div>
  );
}

function VacancyModalHeader({ vacancy, onClose }: { vacancy: AdminVacancy; onClose: () => void }) {
  return (
    <header className="admin-modal__header admin-modal__header--stacked">
      <div className="admin-modal__title-row">
        <h3 className="admin-modal__title" id="vacancy-modal-title">{vacancy.title}</h3>
        <button type="button" className="admin-modal__close" aria-label="Закрыть модальное окно" onClick={onClose}>✕</button>
      </div>
      <VacancyHeaderBadges vacancy={vacancy} />
      <div className="admin-modal-salary">{formatSalary(vacancy.salary)}</div>
    </header>
  );
}

// ---------- Structured Section List ----------

function VacancySectionList({ title, icon, items }: { title: string; icon: string; items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <section className="admin-vacancy-section">
      <h4 className="admin-vacancy-section__heading">
        <span className="admin-section-icon">{icon}</span> {title}
      </h4>
      <ul className="admin-section-bullets">
        {items.map((item, idx) => (
          <li key={idx} className="admin-section-bullet-item">{item}</li>
        ))}
      </ul>
    </section>
  );
}

function VacancySkillsSection({ skills }: { skills: string[] }) {
  if (skills.length === 0) return null;
  return (
    <section className="admin-vacancy-section">
      <h4 className="admin-vacancy-section__heading">
        <span className="admin-section-icon">⚡</span> Ключевые навыки и стек
      </h4>
      <div className="admin-vacancy-skills-grid">
        {skills.map((skill, idx) => (
          <span key={idx} className="admin-skill-badge">{skill}</span>
        ))}
      </div>
    </section>
  );
}

// ---------- Modal Body Content ----------

function VacancyOverviewSection({ description, aboutCompany, contactInfo }: {
  description: string; aboutCompany?: string; contactInfo?: string;
}) {
  return (
    <>
      <section className="admin-vacancy-section">
        <h4 className="admin-vacancy-section__heading">
          <span className="admin-section-icon">📌</span> О позиции
        </h4>
        <p className="admin-vacancy-prose">{description}</p>
      </section>
      {aboutCompany && (
        <section className="admin-vacancy-section">
          <h4 className="admin-vacancy-section__heading">
            <span className="admin-section-icon">🏢</span> О компании
          </h4>
          <p className="admin-vacancy-prose">{aboutCompany}</p>
        </section>
      )}
      {contactInfo && (
        <section className="admin-vacancy-section">
          <h4 className="admin-vacancy-section__heading">
            <span className="admin-section-icon">📬</span> Контакты и отклик
          </h4>
          <code className="admin-contact-code">{contactInfo}</code>
        </section>
      )}
    </>
  );
}

function VacancyModalBody({ vacancy }: { vacancy: AdminVacancy }) {
  return (
    <div className="admin-modal__body admin-modal__body--rich">
      <VacancyDiagnosticBar vacancy={vacancy} />
      <VacancyOverviewSection
        description={vacancy.description}
        aboutCompany={vacancy.aboutCompany}
        contactInfo={vacancy.contactInfo}
      />
      <VacancySectionList title="Обязанности и задачи" icon="🎯" items={vacancy.responsibilities} />
      <VacancySkillsSection skills={vacancy.requiredSkills} />
      <VacancySectionList title="Требования к кандидату" icon="📋" items={vacancy.qualifications} />
      <VacancySectionList title="Будет плюсом" icon="🌟" items={vacancy.niceToHave} />
      <VacancySectionList title="Условия и бенефиты" icon="🎁" items={vacancy.benefits} />
    </div>
  );
}

// ---------- Modal Footer & Orchestrator ----------

function VacancyModalFooter({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <footer className="admin-modal__footer">
      <a href={url} target="_blank" rel="noopener noreferrer" className="admin-btn admin-btn--primary">
        Перейти к оригиналу вакансии ↗
      </a>
      <button type="button" className="admin-btn admin-btn--secondary" onClick={onClose}>
        Закрыть
      </button>
    </footer>
  );
}

/**
 * Полную запись читает окно, а не список: список отдаётся кратким видом внутри
 * байтового бюджета маршрута, иначе ответ обрывается на середине строки
 * (INC-032).
 */
function useAdminVacancy(vacancyId: string) {
  const [vacancy, setVacancy] = useState<AdminVacancy | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setVacancy(null);
    setError(null);
    getAdminVacancy(vacancyId, controller.signal)
      .then(setVacancy)
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'Не удалось загрузить вакансию');
      });
    return () => controller.abort();
  }, [vacancyId]);

  return { vacancy, error };
}

export function VacancyDetailModal({ vacancyId, onClose }: { vacancyId: string; onClose: () => void }) {
  const { vacancy, error } = useAdminVacancy(vacancyId);
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="admin-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vacancy-modal-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <button type="button" className="admin-modal-backdrop" aria-label="Закрыть модальное окно" onClick={onClose} tabIndex={-1} />
      <div className="admin-modal admin-modal--large">
        {error ? (
          <div className="admin-alert admin-alert--error" role="alert">
            <h3 className="admin-modal__title" id="vacancy-modal-title">Вакансия не открылась</h3>
            <p>{error}</p>
            <button type="button" className="admin-btn admin-btn--secondary" onClick={onClose}>
              Закрыть
            </button>
          </div>
        ) : vacancy ? (
          <>
            <VacancyModalHeader vacancy={vacancy} onClose={onClose} />
            <VacancyModalBody vacancy={vacancy} />
            <VacancyModalFooter url={vacancy.url} onClose={onClose} />
          </>
        ) : (
          <div className="admin-loading-state">
            <h3 className="admin-modal__title" id="vacancy-modal-title">Загрузка вакансии…</h3>
            <button type="button" className="admin-btn admin-btn--secondary" onClick={onClose}>
              Закрыть
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
