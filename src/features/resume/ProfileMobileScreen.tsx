import { useEffect, useRef, useState } from 'react';
import { CandidateFootprintAuditView } from '../reputation/CandidateFootprintAuditView';
import { ProfileAchievementsSection } from './ProfileAchievementsSection';
import { ProfileRecommendationsSection } from './ProfileRecommendationsSection';
import { ProfileCertificatesSection } from './ProfileTileSections';
import {
  ProfileMobileEducation,
  ProfileMobileLanguages,
  ProfileMobileProjects,
} from './ProfileMobileCollections';
import {
  ProfileMobileExperienceDetail,
  ProfileMobileExperienceEditor,
  ProfileMobileExperienceList,
} from './ProfileMobileExperience';
import {
  ProfileMobileEmptyResume,
  ProfileMobileHomeIdentity,
  ProfileMobileResumeHome,
} from './ProfileMobileHome';
import {
  ProfileMobileContacts,
  ProfileMobileRelocation,
  ProfileMobileSourceDetails,
} from './ProfileMobileSections';
import { ProfileMobileSkillAdd, ProfileMobileSkills } from './ProfileMobileSkills';
import { profileResumeReviewIssueCount } from './ProfileReviewAndVersions';
import { profileRelocationMobileLabel } from './ProfileSideRail';
import {
  profileMobileTitle,
  useProfileMobileNavigation,
  type ProfileMobileRoute,
} from './profileMobileNavigation';
import type { ProfileMobileDataProps, ProfileMobileNavigationProps } from './profileMobileTypes';
import type { ProfileTab } from './profileTabs';
import { getResumeVersions } from './resumeVersionsApi';
import {
  RESUME_VERSION_COLLECTION_CHANGED_EVENT,
  useProfileAtsAssessment,
} from './useProfileAtsAssessment';
import { useMobileProfileFocus } from './useMobileProfileFocus';
import { ProfileMobileAts } from './ProfileMobileReadiness';
import { ProfileMobileReview } from './ProfileMobileReview';
import { ProfileMobileAbout } from './ProfileMobileAbout';
import { ProfileMobileVersions } from './ProfileMobileVersions';
import { ProfileRefreshNotice } from './ProfileRefreshNotice';
import './profileMobile.css';

type DetailProps = ProfileMobileDataProps &
  ProfileMobileNavigationProps & { readonly route: ProfileMobileRoute };
type ProfileMobileScreenProps = ProfileMobileDataProps & { readonly isDraftEmpty: boolean };

function useVersionCount(candidateId: string) {
  const [count, setCount] = useState<number>();
  useEffect(() => {
    let request: AbortController | undefined;
    const load = () => {
      request?.abort();
      request = new AbortController();
      const current = request;
      void getResumeVersions({ limit: 1, signal: current.signal }).then(
        (list) => {
          // The master resume counts as one version; a malformed total shows «—», never NaN.
          if (!current.signal.aborted)
            setCount(Number.isFinite(list.totalCount) ? 1 + list.totalCount : undefined);
        },
        () => {
          if (!current.signal.aborted) setCount(undefined);
        },
      );
    };
    setCount(undefined);
    load();
    window.addEventListener(RESUME_VERSION_COLLECTION_CHANGED_EVENT, load);
    return () => {
      request?.abort();
      window.removeEventListener(RESUME_VERSION_COLLECTION_CHANGED_EVENT, load);
    };
  }, [candidateId]);
  return count;
}

function MobileCollectionDetail(props: DetailProps) {
  switch (props.route.page) {
    case 'edu':
      return (
        <ProfileMobileEducation
          {...props}
          initialAdd={
            props.route.entryId === 'new-course'
              ? 'course'
              : props.route.entryId === 'new-education'
                ? 'education'
                : undefined
          }
        />
      );
    case 'proj':
      return <ProfileMobileProjects {...props} initialAdd={props.route.entryId === 'new'} />;
    case 'lang':
      return <ProfileMobileLanguages {...props} initialAdd={props.route.entryId === 'new'} />;
    case 'certifications':
      return <ProfileCertificatesSection {...props} />;
    case 'recommendations':
      return <ProfileRecommendationsSection {...props} />;
    case 'achievements':
      return <ProfileAchievementsSection {...props} />;
    default:
      return null;
  }
}

function MobileProfileDetail(props: DetailProps) {
  switch (props.route.page) {
    case 'exp':
      return <ProfileMobileExperienceList {...props} />;
    case 'job':
      return <ProfileMobileExperienceDetail {...props} />;
    case 'jobadd':
    case 'jobedit':
      return <ProfileMobileExperienceEditor {...props} />;
    case 'about':
      return <ProfileMobileAbout {...props} />;
    case 'check':
      return <ProfileMobileReview {...props} />;
    case 'docs':
      return <ProfileMobileVersions {...props} />;
    case 'src':
      return <ProfileMobileSourceDetails {...props} />;
    case 'reloc':
      return <ProfileMobileRelocation {...props} />;
    case 'contacts':
      return <ProfileMobileContacts {...props} />;
    case 'skilladd':
      return <ProfileMobileSkillAdd {...props} />;
    default:
      return <MobileCollectionDetail {...props} />;
  }
}

function useMobileScene(
  props: ProfileMobileDataProps,
  navigation: ReturnType<typeof useProfileMobileNavigation>,
) {
  const { route, back, hasBack } = navigation;
  const employer = props.draft.experience.find((entry) => entry.id === route.entryId)?.employer;
  const title = profileMobileTitle(route, employer);
  const onSceneChange = props.onMobileSceneChange;
  useEffect(() => {
    onSceneChange?.({ title, onBack: hasBack ? back : undefined });
    return () => onSceneChange?.(null);
  }, [onSceneChange, title, hasBack, back]);
  useEffect(() => {
    const main = document.querySelector('.career-main');
    main?.scrollTo({ top: 0 });
  }, [route]);
}

function MobileHome(
  props: Parameters<typeof ProfileMobileHomeIdentity>[0] & ProfileMobileNavigationProps,
) {
  return (
    <>
      <ProfileMobileHomeIdentity {...props} />
      {props.activeTab === 'resume' ? (
        props.isDraftEmpty ? (
          <ProfileMobileEmptyResume {...props} />
        ) : (
          <ProfileMobileResumeHome {...props} />
        )
      ) : props.activeTab === 'skills' ? (
        <div
          id="profile-panel-skills"
          className="pm-pane"
          role="tabpanel"
          aria-labelledby="profile-mobile-tab-skills"
        >
          <ProfileMobileSkills {...props} />
        </div>
      ) : (
        <div
          id="profile-panel-trace"
          className="pm-pane"
          role="tabpanel"
          aria-labelledby="profile-mobile-tab-trace"
        >
          <CandidateFootprintAuditView
            candidateId={props.candidateId}
            onOpenResumeVersions={() => props.open({ page: 'docs' })}
          />
        </div>
      )}
    </>
  );
}

function useMobileVacancyRequirement(
  request: ProfileMobileDataProps['vacancyRequirement'],
  open: ProfileMobileNavigationProps['open'],
) {
  const seen = useRef<string>();
  useEffect(() => {
    if (!request || seen.current === request.requestId) return;
    seen.current = request.requestId;
    open({ page: 'exp' });
  }, [request, open]);
}

export function ProfileMobileScreen(props: ProfileMobileScreenProps) {
  const navigation = useProfileMobileNavigation();
  const [localTab, setLocalTab] = useState<ProfileTab>('resume');
  const activeTab = props.tab ?? localTab;
  const onTab = (tab: ProfileTab) => {
    setLocalTab(tab);
    props.onTabChange?.(tab);
  };
  const ats = useProfileAtsAssessment({
    onDemand: true,
    refreshKey: props.view?.savedAt?.updatedAt,
  });
  const versionCount = useVersionCount(props.candidateId);
  useMobileScene(props, navigation);
  useMobileVacancyRequirement(props.vacancyRequirement, navigation.open);
  useMobileProfileFocus(props, navigation, setLocalTab);
  const homeProps = {
    ...props,
    ...navigation,
    activeTab,
    onTab,
    atsScore: ats.assessment?.total.score ?? null,
    reviewCount: profileResumeReviewIssueCount(props.view, props.draft),
    versionCount,
    relocationLabel: profileRelocationMobileLabel(props.relocationSummary ?? 'unknown'),
  };
  return (
    <div
      className="career-profile-mobile pm"
      data-mobile-profile-page={navigation.route.page}
      data-profile-tab={activeTab}
      aria-busy={props.loading || props.saving || undefined}
    >
      <ProfileRefreshNotice error={props.error} onRetry={props.onRetry} />
      {props.saveError ? (
        <p className="career-resume-error" role="alert">
          {props.saveError}
        </p>
      ) : null}
      {navigation.route.page === 'home' ? (
        <MobileHome {...homeProps} />
      ) : navigation.route.page === 'ats' ? (
        <ProfileMobileAts {...props} ats={ats} />
      ) : (
        <MobileProfileDetail
          key={`${navigation.route.page}:${navigation.route.entryId ?? ''}`}
          {...props}
          {...navigation}
        />
      )}
    </div>
  );
}
