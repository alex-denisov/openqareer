import type { CefrLevel } from '../resume/resumeTypes';
import type { ProfileFact } from './profileIngestion';

/** LinkedIn's remote/on-site/hybrid label (architecture B265 §1). */
export type ParsedWorkplaceType = 'on_site' | 'hybrid' | 'remote';

export interface ParsedResumeExperience {
  title: string;
  employer: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  current: boolean;
  responsibilities: string[];
  achievements: string[];
  /** v2 */
  employmentType?: string;
  /** v2 */
  workplaceType?: ParsedWorkplaceType;
  /** v2 */
  skills?: string[];
  /** v2: source-only, dropped before it ever reaches a draft. */
  employerLogoSourceUrl?: string;
  /** v2: groups several roles held at the same employer. */
  employerGroupKey?: string;
}

export interface ParsedResumeEducation {
  institution: string;
  qualification?: string;
  startDate?: string;
  endDate?: string;
  /** v2 */
  description?: string;
}

export interface ParsedResumeCertification {
  name: string;
  issuer?: string;
  issuedAt?: string;
  expiresAt?: string;
  credentialId?: string;
  url?: string;
}

export interface ParsedResumeProject {
  name: string;
  startDate?: string;
  endDate?: string;
  current?: boolean;
  description?: string;
  employer?: string;
  url?: string;
  skills?: string[];
}

export type ParsedResumeAchievementKind =
  | 'honor'
  | 'publication'
  | 'patent'
  | 'organization'
  | 'volunteering';

export interface ParsedResumeAchievement {
  kind: ParsedResumeAchievementKind;
  title: string;
  issuer?: string;
  role?: string;
  date?: string;
  endDate?: string;
  description?: string;
  url?: string;
}

/**
 * A proposal read from a native source. Owner decision (ticket §3c): never
 * written to work preferences directly, only ever offered on screen.
 */
export interface ParsedResumeOpenToWork {
  roles: string[];
  locations: string[];
  workplaceTypes: ParsedWorkplaceType[];
}

export interface ParsedResumeCourse {
  name: string;
  institution?: string;
  year?: string;
  certificateUrl?: string;
}

export interface ParsedResumeTest {
  name: string;
  provider?: string;
  score?: string;
  year?: string;
}

export interface ParsedResumeRecommendation {
  recommender?: string;
  organization?: string;
  position?: string;
  text?: string;
  contact?: string;
  /** v2 */
  relationship?: string;
  /** v2 */
  date?: string;
}

export interface ParsedResumeLanguage {
  name: string;
  cefr?: CefrLevel;
}

interface ParsedResumeContact {
  email?: string;
  phone?: string;
  telegram?: string;
  location?: string;
  links: string[];
  /** v2 */
  linkedinUrl?: string;
}

export interface ParsedResumeAdditional {
  citizenship?: string;
  workSchedule?: string;
  relocation?: string;
  driversLicense?: string;
}

export interface ParsedResume {
  fullName?: string;
  targetRole?: string;
  photoUrl?: string;
  /** v2 */
  headline?: string;
  /** v2: source-only; never lands in a stored draft (media caching, slice 2). */
  photoSourceUrl?: string;
  about?: string;
  contact: ParsedResumeContact;
  experience: ParsedResumeExperience[];
  skills: string[];
  education: ParsedResumeEducation[];
  courses: ParsedResumeCourse[];
  tests: ParsedResumeTest[];
  recommendations: ParsedResumeRecommendation[];
  languages: ParsedResumeLanguage[];
  additional?: ParsedResumeAdditional;
  // v2
  certifications?: ParsedResumeCertification[];
  // v2
  projects?: ParsedResumeProject[];
  // v2
  achievements?: ParsedResumeAchievement[];
  // v2: proposal only — see ParsedResumeOpenToWork.
  openToWork?: ParsedResumeOpenToWork;
  // Note: no `birthday` field exists anywhere in this type on purpose. The
  // owner decided a candidate's date of birth never enters the model; the
  // extractor (slice 5) must discard it at the source rather than have a
  // field here to discard it into (tickets/B265 §3a).
  rawText: string;
}

export interface ProfileFactDraft {
  fact: ProfileFact;
  value: string;
  decision: 'pending' | 'confirmed' | 'corrected' | 'rejected';
}

