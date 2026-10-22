import { useEffect, useState } from 'react';
import { UserCircle } from '@phosphor-icons/react';
import type { RecruiterContact } from '../../../shared/recruiterContact';
import { PushRow } from './VacancyMobilePathPages';
import { getRecruiterContacts } from './recruiterContactsApi';

/** Saved recruiters of the vacancy; a read only — no lookup is started from the phone. */
function useKnownRecruiters(vacancyId: string): readonly RecruiterContact[] {
  const [contacts, setContacts] = useState<readonly RecruiterContact[]>([]);
  useEffect(() => {
    let active = true;
    void getRecruiterContacts(vacancyId)
      .then((result) => {
        if (active) setContacts(result.contacts);
      })
      .catch(() => {
        // Unknown recruiter: the block stays hidden, as in the mockup without one.
      });
    return () => {
      active = false;
    };
  }, [vacancyId]);
  return contacts;
}

/** «Рекрутер» on 390 «Круг 1» (mockup 4; G5 R3): name, role and company when known. */
export function PushRecruiterGroup({ vacancyId }: { readonly vacancyId: string }) {
  const recruiters = useKnownRecruiters(vacancyId);
  if (recruiters.length === 0) return null;
  return (
    <section className="vacancy-push-group">
      <h3 className="vacancy-push-cap">Рекрутер</h3>
      <div className="vacancy-push-list">
        {recruiters.map((contact) => (
          <PushRow
            key={contact.id}
            icon={<UserCircle aria-hidden="true" />}
            title={contact.fullName}
            lines={[[contact.roleTitle, contact.companyName].filter(Boolean).join(', ')].filter(
              Boolean,
            )}
          />
        ))}
      </div>
    </section>
  );
}
