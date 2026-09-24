export type ProfileTab = 'profile' | 'documents';

/**
 * "Профиль / Документ и форматы" — lives in the page header, to the right of
 * the «Профиль» title, not next to the topcard (owner review round 3): the
 * topcard is a candidate fact sheet, the tabs pick what the whole screen
 * shows, so they belong beside the title that names the screen.
 */
export function ProfileTabs({
  tab,
  onTab,
}: {
  readonly tab: ProfileTab;
  readonly onTab: (tab: ProfileTab) => void;
}) {
  return (
    <div className="career-profile-screen-tabs" role="group" aria-label="Что показать">
      <button
        type="button"
        className={tab === 'profile' ? 'is-active' : ''}
        aria-pressed={tab === 'profile'}
        onClick={() => onTab('profile')}
      >
        Профиль
      </button>
      <button
        type="button"
        className={tab === 'documents' ? 'is-active' : ''}
        aria-pressed={tab === 'documents'}
        onClick={() => onTab('documents')}
      >
        Документ и форматы
      </button>
    </div>
  );
}
