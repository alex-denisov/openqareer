import { useEffect, useRef } from 'react';
import { CaretLeft, X } from '@phosphor-icons/react';
import { useEscapeLayer } from '../shell/escapeLayers';
import { ProfileAboutSection } from './ProfileAboutSection';
import { ProfileAchievementsSection } from './ProfileAchievementsSection';
import { ProfileCoursesSection } from './ProfileCoursesSection';
import { ProfileEducationSection } from './ProfileEducationSection';
import { ProfileExperienceSection } from './ProfileExperienceSection';
import { ProfileLanguagesSection } from './ProfileLanguagesSection';
import { ProfileRecommendationsSection } from './ProfileRecommendationsSection';
import { ProfileSkillsSection } from './ProfileSkillsSection';
import { ProfileCertificatesSection, ProfileProjectsSection } from './ProfileTileSections';
import { ProfileMobileContacts } from './ProfileMobileSections';
import type { ProfileMobileDataProps } from './profileMobileTypes';

export const PROFILE_DATA_SECTIONS = {
  name: 'Имя',
  contacts: 'Контакты',
  about: 'Обо мне',
  experience: 'Опыт',
  education: 'Образование',
  projects: 'Проекты',
  skills: 'Навыки',
  languages: 'Языки',
  courses: 'Курсы',
  certifications: 'Сертификаты',
  recommendations: 'Рекомендации',
  achievements: 'Достижения',
} as const;
export type ProfileDataSection = keyof typeof PROFILE_DATA_SECTIONS;

interface DataDialogProps extends ProfileMobileDataProps {
  readonly section?: ProfileDataSection;
  readonly onSelect: (section?: ProfileDataSection) => void;
  readonly onClose: () => void;
  /** Contacts saved: the whole dialog closes and the screen says «Сохранено». */
  readonly onContactsSaved?: () => void;
}

function ProfileDataSectionView(props: DataDialogProps) {
  switch (props.section) {
    case 'name':
    case 'contacts':
      return (
        <ProfileMobileContacts
          {...props}
          back={() => props.onSelect(undefined)}
          onSaved={props.onContactsSaved ?? props.onClose}
        />
      );
    case 'about':
      return (
        <ProfileAboutSection
          {...props}
          detailView
          onSuggestWithConsultant={props.onSuggestAboutWithConsultant}
        />
      );
    case 'experience':
      return <ProfileExperienceSection {...props} />;
    case 'education':
      return <ProfileEducationSection {...props} />;
    case 'projects':
      return <ProfileProjectsSection {...props} />;
    case 'skills':
      return <ProfileSkillsSection {...props} />;
    case 'languages':
      return <ProfileLanguagesSection {...props} />;
    case 'courses':
      return <ProfileCoursesSection {...props} importedLabel={props.importedSource?.label} />;
    case 'certifications':
      return <ProfileCertificatesSection {...props} />;
    case 'recommendations':
      return <ProfileRecommendationsSection {...props} />;
    case 'achievements':
      return <ProfileAchievementsSection {...props} />;
    default:
      return (
        <div className="profile-data-dialog-menu">
          {Object.entries(PROFILE_DATA_SECTIONS).map(([section, label]) => (
            <button
              type="button"
              className="career-quiet-button"
              key={section}
              onClick={() => props.onSelect(section as ProfileDataSection)}
            >
              {label}
            </button>
          ))}
        </div>
      );
  }
}

function useDialogFocus(props: DataDialogProps) {
  const { section, profileFocusRequest, onProfileFocusHandled } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const handled = useRef<ProfileMobileDataProps['profileFocusRequest']>();
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      queueMicrotask(() => {
        if (opener?.isConnected) opener.focus();
      });
    };
  }, []);
  useEffect(() => {
    const request = profileFocusRequest;
    const field = section === 'name' ? 'fullName' : section === 'contacts' ? 'email' : undefined;
    const content = ref.current?.querySelector('.profile-data-dialog-content');
    const control = field
      ? content?.querySelector<HTMLInputElement>(`input[name="${field}"]`)
      : content?.querySelector<HTMLElement>('input, textarea, button:not([disabled]), select');
    if (!control) return;
    control.focus();
    if (!request || handled.current === request || request.section !== section) return;
    handled.current = request;
    onProfileFocusHandled?.();
  }, [section, profileFocusRequest, onProfileFocusHandled]);
  return ref;
}

/** The name entry opens the same contacts form, so it carries the same title (A9). */
function dialogSectionTitleKey(section: ProfileDataSection): ProfileDataSection {
  return section === 'name' ? 'contacts' : section;
}

function ProfileDataDialogHeader(props: DataDialogProps) {
  return (
    <header className="profile-data-dialog-header">
      {props.section ? (
        <button
          type="button"
          className="career-quiet-button"
          aria-label="К списку данных профиля"
          onClick={() => props.onSelect(undefined)}
        >
          <CaretLeft size="1em" aria-hidden="true" />
        </button>
      ) : null}
      <h2 id="profile-data-dialog-title">
        {props.section
          ? PROFILE_DATA_SECTIONS[dialogSectionTitleKey(props.section)]
          : 'Данные профиля'}
      </h2>
      <button
        type="button"
        className="career-quiet-button"
        aria-label="Закрыть данные профиля"
        onClick={props.onClose}
      >
        <X size="1em" aria-hidden="true" />
      </button>
    </header>
  );
}

export function ProfileDataDialog(props: DataDialogProps) {
  useEscapeLayer(props.onClose);
  const ref = useDialogFocus(props);
  const onSuggest = props.onSuggestAboutWithConsultant;
  return (
    <dialog
      ref={ref}
      className="profile-data-dialog"
      aria-labelledby="profile-data-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
    >
      <ProfileDataDialogHeader {...props} />
      <div className="profile-data-dialog-content">
        <ProfileDataSectionView
          key={props.section ?? 'menu'}
          {...props}
          onSuggestAboutWithConsultant={
            onSuggest
              ? () => {
                  props.onClose();
                  onSuggest();
                }
              : undefined
          }
        />
      </div>
    </dialog>
  );
}
