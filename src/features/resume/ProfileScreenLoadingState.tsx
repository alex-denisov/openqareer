import { ProfileMobileTabs } from './ProfileMobileHome';
import { ProfileTabs } from './profileTabs';

function ProfileLoadingContent() {
  return (
    <div className="career-profile-screen-loading-content" role="status" aria-live="polite">
      <span className="career-profile-screen-loading-bars" aria-hidden="true">
        <span className="career-profile-screen-loading-bar is-tall" />
        <span className="career-profile-screen-loading-bar is-long" />
        <span className="career-profile-screen-loading-bar is-medium" />
      </span>
      <p>Загружаем профиль…</p>
    </div>
  );
}

function ProfileMobileLoadingSummary() {
  return (
    <div className="pm-id career-profile-screen-loading-summary" aria-hidden="true">
      <span className="avatar career-profile-screen-loading-avatar" />
      <span className="career-profile-screen-loading-copy">
        <span className="career-profile-screen-loading-line is-long" />
        <span className="career-profile-screen-loading-line is-medium" />
      </span>
      <span className="career-profile-screen-loading-score" />
    </div>
  );
}

function ProfileDesktopLoadingSummary() {
  return (
    <div
      className="career-profile-screen-topcard career-profile-screen-loading-summary"
      aria-hidden="true"
    >
      <div className="career-profile-screen-id-row">
        <span className="career-profile-screen-avatar career-profile-screen-loading-avatar" />
        <div className="career-profile-screen-id-main career-profile-screen-loading-copy">
          <span className="career-profile-screen-loading-line is-long" />
          <span className="career-profile-screen-loading-line is-medium" />
        </div>
        <span className="career-profile-screen-loading-score" />
      </div>
      <div className="career-profile-screen-loading-meta">
        <span className="career-profile-screen-loading-line is-wide" />
        <span className="career-profile-screen-loading-line is-long" />
      </div>
    </div>
  );
}

export function ProfileScreenLoadingState({ mobile }: { readonly mobile: boolean }) {
  if (mobile) {
    return (
      <div
        className="career-profile-mobile pm career-profile-screen-loading"
        data-mobile-profile-page="home"
        data-profile-tab="resume"
        aria-busy="true"
      >
        <ProfileMobileLoadingSummary />
        <ProfileMobileTabs activeTab="resume" onTab={() => undefined} disabled />
        <ProfileLoadingContent />
      </div>
    );
  }

  return (
    <div
      className="career-profile-screen-view career-profile-screen-loading"
      data-profile-tab="resume"
      aria-busy="true"
    >
      <div className="career-profile-screen-header-row">
        <ProfileDesktopLoadingSummary />
      </div>
      <ProfileTabs tab="resume" onTab={() => undefined} disabled />
      <ProfileLoadingContent />
    </div>
  );
}
