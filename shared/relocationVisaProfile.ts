import type { MobilityCandidateProfile } from './countryFit/types';
import type { RelocationQuestionnaire } from './relocationQuestionnaire';
export function relocationVisaProfile(profile: RelocationQuestionnaire | null): MobilityCandidateProfile {
  if (!profile) return {};
  const education = profile.education.education;
  const recognized = education.filter((e) => e.recognitionStatus === 'recognized').map((e) => e.countryCode);
  const family = profile.family;
  return {
    citizenshipCountryCodes: profile.citizenshipDocuments.citizenshipCountryCodes,
    ...(recognized.length ? { recognizedDegreeCountryCodes: recognized } : {}),
    ...(education.some((e) => e.completedAt) ? { completedFormalQualification: true } : {}),
    ...(family.childrenCount !== undefined && (family.partnerStatus === 'has_partner' || family.partnerStatus === 'no_partner') ? { family: { hasPartner: family.partnerStatus === 'has_partner', children: family.childrenCount } } : {}),
  };
}
