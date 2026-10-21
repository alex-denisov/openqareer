import { useEffect, useRef, useState } from 'react';
import { Check, X } from '@phosphor-icons/react';
import type { CandidateCompanyOpportunity } from '../../../shared/candidateCompany';
import {
  dismissCandidateCompanyContactProposal,
  getCandidateCompanyPage,
  saveCandidateCompanyNextStep,
} from './candidateCompaniesApi';
import {
  formatObservedDate,
  groupCompanyPeople,
  type CompanyPerson,
} from './companiesAndPeopleUtils';
import { getVacancyConnectionCircles } from './vacancyLetterApi';
import { dativeNameRu } from '../today/dativeNameRu';

const PROPOSAL_DUE_DAYS = 3;
const MAX_COMPANIES_CHECKED = 3;

interface ContactProposal {
  readonly company: CandidateCompanyOpportunity;
  readonly person: CompanyPerson;
  readonly dueAt: string;
}

function dueDate(now = new Date()): string {
  const due = new Date(now.getTime() + PROPOSAL_DUE_DAYS * 24 * 60 * 60 * 1000);
  return due.toISOString().slice(0, 10);
}

async function firstCircleOneContact(
  company: CandidateCompanyOpportunity,
): Promise<CompanyPerson | null> {
  const responses = await Promise.all(
    company.vacancies.slice(0, 3).map((vacancy) => getVacancyConnectionCircles(vacancy.id)),
  );
  return groupCompanyPeople(responses).people.find((person) => person.circle === 1) ?? null;
}

/** A wanted company without a step, not dismissed, with a known first-circle contact. */
async function findContactProposal(): Promise<ContactProposal | null> {
  const page = await getCandidateCompanyPage({ filter: 'want', sort: 'default', offset: 0 });
  const candidates = page.items
    .filter(
      (company) =>
        !company.nextStep && !company.contactProposalDismissed && (company.contactsCount ?? 0) > 0,
    )
    .slice(0, MAX_COMPANIES_CHECKED);
  for (const company of candidates) {
    const person = await firstCircleOneContact(company);
    if (person) return { company, person, dueAt: dueDate() };
  }
  return null;
}

function useContactProposal() {
  const [proposal, setProposal] = useState<ContactProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  useEffect(() => {
    let active = true;
    void findContactProposal()
      .then((found) => {
        if (active) setProposal(found);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  async function resolve(accepted: boolean) {
    if (!proposal || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      if (accepted) {
        await saveCandidateCompanyNextStep(
          proposal.company.key,
          `написать ${dativeNameRu(proposal.person.fullName)}`,
          proposal.dueAt,
        );
      } else {
        await dismissCandidateCompanyContactProposal(proposal.company.key);
      }
      setProposal(null);
    } catch {
      setError('Не удалось сохранить решение. Попробуйте ещё раз.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return { proposal, busy, error, resolve };
}

/** B439: the consultant offers a step for a wanted company where the candidate knows someone. */
export function CompaniesContactProposal() {
  const { proposal, busy, error, resolve } = useContactProposal();
  if (!proposal) return null;
  return (
    <section className="career-expert-proposal" aria-label="Добавить шаг в «Хочу»" aria-busy={busy}>
      <p className="career-expert-proposal-title">Добавить шаг в «Хочу»</p>
      <p>
        Написать {dativeNameRu(proposal.person.fullName)} ({proposal.company.name}) до{' '}
        {formatObservedDate(proposal.dueAt)}. Письмо подготовит консультант, отправите вы.
      </p>
      <div className="career-expert-actions">
        <button
          type="button"
          className="career-quiet-button career-inline-ok"
          disabled={busy}
          onClick={() => void resolve(true)}
        >
          <Check size={16} aria-hidden="true" />
          Принять
        </button>
        <button
          type="button"
          className="career-quiet-button"
          disabled={busy}
          onClick={() => void resolve(false)}
        >
          <X size={16} aria-hidden="true" />
          Не сейчас
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
