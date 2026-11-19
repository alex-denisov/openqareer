/**
 * B697 / B645: who among the candidate's contacts hires, judged by the job title.
 * 0 — recruiters and HR (they run the hiring), 1 — managers who own a team, null — does not hire.
 */
const RECRUITING = /(recruit|рекрут|talent|\bhr\b|hrbp|human resources|people partner|подбор|найм|кадр)/iu;
const MANAGING =
  /(руковод|директор|head\b|head of|\bvp\b|vice president|chief|\bc[teiop]o\b|founder|основател|владел|manager|менеджер по разработке|team ?lead|тимлид|lead\b)/iu;

export function hiringRank(roleTitle: string): 0 | 1 | null {
  if (RECRUITING.test(roleTitle)) return 0;
  if (MANAGING.test(roleTitle)) return 1;
  return null;
}
