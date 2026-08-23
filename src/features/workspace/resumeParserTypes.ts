import type { CefrLevel } from '../resume/resumeTypes';
import type { ProfileFact } from './profileIngestion';


export interface ParsedResumeExperience {
  title: string;
  employer: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  current: boolean;
  responsibilities: string[];
  achievements: string[];
}

export interface ParsedResumeEducation {
  institution: string;
  qualification?: string;
  startDate?: string;
  endDate?: string;
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
  rawText: string;
}

export interface ProfileFactDraft {
  fact: ProfileFact;
  value: string;
  decision: 'pending' | 'confirmed' | 'corrected' | 'rejected';
}

