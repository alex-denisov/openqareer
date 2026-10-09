import { useCallback, useRef, type KeyboardEvent, type MutableRefObject } from 'react';

export type ProfileTab = 'resume' | 'skills' | 'trace';

interface ProfileTabItem {
  readonly id: ProfileTab;
  readonly label: string;
}

const PROFILE_TABS: readonly ProfileTabItem[] = [
  { id: 'resume', label: 'Резюме' },
  { id: 'skills', label: 'Навыки' },
  { id: 'trace', label: 'Цифровой след' },
];

function useTabKeyboard(
  refs: MutableRefObject<Array<HTMLButtonElement | null>>,
  onTab: (tab: ProfileTab) => void,
) {
  return useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const nextIndex =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? PROFILE_TABS.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + PROFILE_TABS.length) %
              PROFILE_TABS.length;
      const next = PROFILE_TABS[nextIndex];
      if (!next) return;
      onTab(next.id);
      requestAnimationFrame(() => refs.current[nextIndex]?.focus());
    },
    [onTab, refs],
  );
}

function ProfileTabButton({
  item,
  index,
  selected,
  count,
  register,
  onClick,
  onKeyDown,
}: {
  readonly item: ProfileTabItem;
  readonly index: number;
  readonly selected: boolean;
  readonly count?: number;
  readonly register: (index: number, node: HTMLButtonElement | null) => void;
  readonly onClick: () => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, index: number) => void;
}) {
  return (
    <button
      ref={(node) => register(index, node)}
      type="button"
      role="tab"
      id={`profile-tab-${item.id}`}
      aria-controls={`profile-panel-${item.id}`}
      aria-selected={selected}
      aria-label={count === undefined ? item.label : `${item.label}, ${count}`}
      tabIndex={selected ? 0 : -1}
      className={selected ? 'is-active' : ''}
      onClick={onClick}
      onKeyDown={(event) => onKeyDown(event, index)}
    >
      {item.label}
      {count !== undefined ? (
        <span className="career-profile-screen-tab-count" aria-hidden="true">
          {count}
        </span>
      ) : null}
    </button>
  );
}

export function ProfileTabs({
  tab,
  onTab,
  skillsCount,
}: {
  readonly tab: ProfileTab;
  readonly onTab: (tab: ProfileTab) => void;
  readonly skillsCount?: number;
}) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const handleKeyDown = useTabKeyboard(tabRefs, onTab);
  const register = (index: number, node: HTMLButtonElement | null) => {
    tabRefs.current[index] = node;
  };

  return (
    <div className="career-profile-screen-tabs" role="tablist" aria-label="Профиль">
      {PROFILE_TABS.map((item, index) => {
        const count = item.id === 'skills' ? skillsCount : undefined;
        return (
          <ProfileTabButton
            key={item.id}
            item={item}
            index={index}
            selected={tab === item.id}
            count={count}
            register={register}
            onClick={() => onTab(item.id)}
            onKeyDown={handleKeyDown}
          />
        );
      })}
    </div>
  );
}
