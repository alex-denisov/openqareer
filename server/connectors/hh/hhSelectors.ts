/**
 * hh.ru web-interface selectors used by the B130 browser boundary.
 *
 * `search`/`vacancy`/`apply`/`resume`/`security.applicantProfile` are the
 * `data-qa` hooks distilled from the B130 open-source research
 * (hh-auto-apply-operator, hh-ai-agent, jobclaw) — see
 * `docs/v1-release/tasks/tickets/B130-repos-analysis.md`.
 *
 * `identity` and the login-surface entries under `security` are defensive
 * unions: each carries the researched `data-qa` hook plus generic HTML
 * fallbacks. They are **not yet confirmed against the live signed-in hh.ru
 * surface** — that confirmation is the B123 live test-account gate. Every
 * consumer must treat a miss as a fail-closed stop, never as success.
 */
export const HH_SELECTORS = {
  search: {
    itemTitle: '[data-qa="serp-item__title"]',
    itemTitleText: '[data-qa="serp-item__title-text"]',
    itemEmployer: '[data-qa="vacancy-serp__vacancy-employer-text"]',
    itemAddress: '[data-qa="vacancy-serp__vacancy-address"]',
    itemCompensation: '[data-qa="vacancy-serp__vacancy-compensation"]',
    pagerNext: '[data-qa="pager-next"]',
    vacancyCount: '[data-qa="vacancies-search-header"]',
  },
  vacancy: {
    title: '[data-qa="vacancy-title"]',
    company: '[data-qa="vacancy-company-name"]',
    description: '[data-qa="vacancy-description"]',
    skills: '[data-qa="skills-element"]',
    salary: '[data-qa="vacancy-salary"]',
    responseButtonTop: '[data-qa="vacancy-response-link-top"]',
    responseButtonBottom: '[data-qa="vacancy-response-link-bottom"]',
    alreadyAppliedBadge: '[data-qa="vacancy-response-already-applied"]',
  },
  apply: {
    popup: '[data-qa="vacancy-response-popup"]',
    resumeRadio: '[data-qa="vacancy-response-popup__resume-item"]',
    letterToggle: '[data-qa="vacancy-response-popup__letter-toggle"]',
    letterTextarea: '[data-qa="vacancy-response-popup__letter-textarea"]',
    submitButton: '[data-qa="vacancy-response-submit-popup"]',
    relocationConfirm: '[data-qa="relocation-warning-confirm"]',
    questionnaireWarning: '[data-qa="vacancy-response-questionnaire"]',
    success: '[data-qa="vacancy-response-success"]',
  },
  /**
   * `/applicant/resumes` card structure, confirmed live on 2026-08-16: the card
   * carries the internal numeric id, the public hash id lives on the card link,
   * and both visibility counters are rendered inside the same card.
   */
  resume: {
    card: '[data-qa="resume"]',
    cardLink: 'a[data-qa^="resume-card-link-"]',
    item: '[data-qa="resume-title"]',
    updatedLabel: '[data-qa="title-description"]',
    searchShows: '[data-qa="search-shows"]',
    newViews: '[data-qa="count-new-views"]',
    // hh.ru writes two space-separated tokens into this one attribute.
    updateDateButton: '[data-qa~="resume-update-button"]',
    publishButton: '[data-qa="resume-publish-button"]',
    nextPublishTime: '[data-qa="resume-next-publish-time"]',
  },
  /**
   * hh.ru sign-in is a three-step applicant flow, observed live on 2026-08-16:
   * account type → credential type + email → password. `data-qa` values carry a
   * trailing ` checked` state on selected radios, so they are matched by prefix.
   */
  login: {
    accountTypeApplicant: '[data-qa^="account-type-card-APPLICANT"]',
    submit: '[data-qa="submit-button"]',
    credentialTypeEmail: '[data-qa^="credential-type-email"]',
    emailInput: '[data-qa="applicant-login-input-email"], input[name="login"]',
    expandPassword: '[data-qa="expand-login-by-password"]',
    passwordInput:
      '[data-qa="applicant-login-input-password"], input[name="password"]',
  },
  identity: {
    applicantEmail: '[data-qa="applicant-email"], [data-qa="resume-owner-email"]',
  },
  security: {
    // Live hh.ru renders several responsive variants of the applicant menu
    // (mainmenu_applicantProfilePage / ...DesktopDrop / ...MobileDrop) and only
    // one of them is visible at a time, so consumers check for presence of any
    // of these signed-in-only nodes rather than visibility of one.
    applicantProfile:
      '[data-qa^="mainmenu_applicantProfile"], [data-qa^="mainmenu_profileAndResumes"], [data-qa^="profile-activator"]',
    captchaContainer: '[data-qa="captcha"], #captcha, .captcha-container',
    oneTimeCodeInput:
      '[data-qa="otp-code-input"], input[name="otpCode"], input[autocomplete="one-time-code"]',
    loginError: '[data-qa="account-login-error"], [role="alert"]',
  },
} as const;
