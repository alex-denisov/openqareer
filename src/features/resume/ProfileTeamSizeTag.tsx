import { UsersThree, Warning } from '@phosphor-icons/react';
import { pluralRu } from '../../../shared/pluralRu';

/** «38 человек», «3 человека» — the team size as the profile writes it. */
export function teamSizeLabel(teamSize: number): string {
  return pluralRu(teamSize, ['человек', 'человека', 'человек']);
}

/** The place's team size chip: a warning while unknown, a plain fact once confirmed. */
export function ProfileTeamSizeTag({ teamSize }: { readonly teamSize: number | undefined }) {
  if (!teamSize) {
    return (
      <span className="career-profile-screen-tag is-warning" data-team-size="unknown">
        <Warning size={14} aria-hidden="true" />
        Размер команды: неизвестно
      </span>
    );
  }
  return (
    <span className="career-profile-screen-tag" data-team-size={teamSize}>
      <UsersThree size={14} aria-hidden="true" />
      Команда: {teamSizeLabel(teamSize)}
    </span>
  );
}
