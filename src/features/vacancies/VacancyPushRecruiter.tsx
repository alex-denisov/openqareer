import { UserCircle } from '@phosphor-icons/react';
import { PushRow } from './VacancyMobilePathPages';
import type { ConnectionCirclePerson, VacancyConnectionCircles } from './vacancyLetterApi';

/**
 * The vacancy's known hiring contacts from the same connection circles «Письмо под вакансию»
 * uses: circle 3 addresses the recruiter directly (G5 R3). No contact search is started here.
 */
function knownRecruiters(data: VacancyConnectionCircles): readonly ConnectionCirclePerson[] {
  const seen = new Set<string>();
  return data.circles
    .filter((circle) => circle.circle === 3 && circle.state === 'available')
    .flatMap((circle) => circle.paths.map((path) => path.recipient))
    .filter((person) => !seen.has(person.id) && Boolean(seen.add(person.id)));
}

/** «Рекрутер» on 390 «Круг 1» (mockup 4; G5 R3): name, role and company when known. */
export function PushRecruiterGroup({ data }: { readonly data: VacancyConnectionCircles }) {
  const recruiters = knownRecruiters(data);
  if (recruiters.length === 0) return null;
  return (
    <section className="vacancy-push-group">
      <h3 className="vacancy-push-cap">Рекрутер</h3>
      <div className="vacancy-push-list">
        {recruiters.map((person) => (
          <PushRow
            key={person.id}
            icon={<UserCircle aria-hidden="true" />}
            title={person.fullName}
            lines={[
              [person.roleTitle, person.companyName ?? data.companyName].filter(Boolean).join(', '),
            ]}
          />
        ))}
      </div>
    </section>
  );
}
