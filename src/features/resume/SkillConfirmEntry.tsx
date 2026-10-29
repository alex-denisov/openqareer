import { useState } from 'react';
import { ListChecks } from '@phosphor-icons/react';
import { SkillConfirmDialog } from '../skills/SkillConfirmDialog';
import type { SkillConfirmation } from '../skills/skillConfirmationApi';

interface SkillConfirmEntryProps {
  readonly skills: readonly SkillConfirmation[] | null;
  readonly className: string;
  readonly onApplied: () => void;
  readonly onDiscuss?: (skillName: string) => void;
}

/** The one «Подтвердить навык» button of the profile and the dialog it opens. */
export function SkillConfirmEntry(props: SkillConfirmEntryProps) {
  const [open, setOpen] = useState(false);
  const { skills } = props;
  return (
    <>
      <button
        type="button"
        className={props.className}
        disabled={!skills?.length}
        onClick={() => setOpen(true)}
      >
        <ListChecks size="1em" aria-hidden="true" />
        Подтвердить навык
      </button>
      {open && skills ? (
        <SkillConfirmDialog
          skills={skills}
          onClose={() => setOpen(false)}
          onDiscuss={props.onDiscuss}
          onApplied={props.onApplied}
        />
      ) : null}
    </>
  );
}
