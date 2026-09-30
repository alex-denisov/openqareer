import { useEffect, useRef } from 'react';
import { Check, X } from '@phosphor-icons/react';
import {
  TARIFF_BENEFITS,
  TARIFF_PLANS,
} from './tariffTypes';
import './paywall.css';

export interface PaywallModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onNavigate: (view: 'tariffs') => void;
}

interface TariffCardProps {
  readonly tier: 'pro' | 'executive';
  readonly isSecondary?: boolean;
  readonly isFeatured?: boolean;
  readonly onSelect?: () => void;
}

function TariffCard({ tier, isSecondary, isFeatured, onSelect }: TariffCardProps) {
  const plan = TARIFF_PLANS[tier];
  const benefits = TARIFF_BENEFITS.filter((b) => b.includedIn.some(included => included === tier));

  return (
    <article
      className={`career-paywall-card${isFeatured ? ' is-featured' : ''}`}
      data-testid={`tariff-card-${tier}`}
    >
      {plan.badge ? <span className="career-paywall-badge">{plan.badge}</span> : null}
      <h3 className="career-paywall-plan-name">{plan.name}</h3>
      <p className="career-paywall-plan-desc">{plan.summary}</p>
      <ul className="career-paywall-features">
        {benefits.map((benefit) => (
          <li key={benefit.id} className="career-paywall-feature-item">
            <Check size={16} weight="bold" className="career-paywall-check-icon" />
            <span>{benefit.title}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={`career-paywall-cta-btn${isSecondary ? ' is-secondary' : ''}`}
        onClick={onSelect}
        data-testid={`select-${tier}-btn`}
      >
        {tier === 'pro' ? 'Выбрать Pro' : 'Выбрать Executive'}
      </button>
    </article>
  );
}

function PaywallHeader({ onClose }: { readonly onClose: () => void }) {
  return (
    <div className="career-paywall-header">
      <div className="career-paywall-titles">
        <h2 id="career-paywall-title" className="career-paywall-title">
          Возможности тарифов Pro и Executive
        </h2>
        <p className="career-paywall-subtitle">
          Выберите тариф для подготовки черновиков. Публикуете вы сами.
        </p>
      </div>
      <button
        type="button"
        className="career-paywall-close-btn"
        onClick={onClose}
        aria-label="Закрыть модальное окно"
        data-testid="career-paywall-close-btn"
      >
        <X size={20} weight="bold" />
      </button>
    </div>
  );
}

function useEscapeKey(isOpen: boolean, onClose: () => void) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);
}

function useDialogFocus(isOpen: boolean, modalRef: { current: HTMLDivElement | null }) {
  useEffect(() => {
    if (!isOpen) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modalRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const buttons = modalRef.current?.querySelectorAll<HTMLButtonElement>('button');
      if (!buttons?.length) return;
      const first = buttons[0]; const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', trap);
    return () => { window.removeEventListener('keydown', trap); opener?.focus(); };
  }, [isOpen, modalRef]);
}

export function PaywallModal({
  isOpen,
  onClose,
  onNavigate,
}: PaywallModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  useEscapeKey(isOpen, onClose);
  useDialogFocus(isOpen, modalRef);

  if (!isOpen) return null;

  return (
    <div
      className="career-paywall-backdrop"
      data-testid="career-paywall-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (!modalRef.current?.contains(e.target as Node)) onClose();
      }}
    >
      <div
        className="career-paywall-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="career-paywall-title"
        ref={modalRef}
        data-testid="career-paywall-modal"
      >
        <PaywallHeader onClose={onClose} />
        <div className="career-paywall-cards">
          <TariffCard tier="pro" isFeatured onSelect={() => { onClose(); onNavigate('tariffs'); }} />
          <TariffCard tier="executive" isSecondary onSelect={() => { onClose(); onNavigate('tariffs'); }} />
        </div>
        <p className="career-paywall-footer">
          Черновик можно проверить, скопировать и опубликовать самостоятельно.
        </p>
      </div>
    </div>
  );
}
