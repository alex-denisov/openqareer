export interface ExecutiveJobMatch {
  id: string;
  title: string;
  company: string;
  location: string;
  salaryRange: string;
  source: 'hh' | 'in' | 'up';
  matchScore: number; // 0 - 100%
  tier: 'C-Level / VP' | 'Director' | 'Lead';
  matchedPillars: string[];
  winProbability: 'Highest' | 'High' | 'Moderate';
  status: 'New Match' | 'Application Sent' | 'Direct Pitch Ready';
  isGreenStatus: boolean;
}

export function getExecutiveJobMatches(): ExecutiveJobMatch[] {
  return [
    {
      id: '1',
      title: 'VP of Technology & Operations',
      company: 'HeadHunter Group',
      location: '📍 Moscow / Hybrid',
      salaryRange: '$180k - $240k',
      source: 'hh',
      matchScore: 96,
      tier: 'C-Level / VP',
      matchedPillars: ['P&L Management ($50M+)', '250+ Team Leadership', 'Cloud Architecture'],
      winProbability: 'Highest',
      status: 'Direct Pitch Ready',
      isGreenStatus: true,
    },
    {
      id: '2',
      title: 'Chief Operating Officer (COO)',
      company: 'Global Scaleup FinTech',
      location: '📍 Dubai, UAE / Relocation',
      salaryRange: '$250k - $320k',
      source: 'in',
      matchScore: 92,
      tier: 'C-Level / VP',
      matchedPillars: ['0->40% Margin Turnaround', 'International Expansion', 'AI Automation'],
      winProbability: 'Highest',
      status: 'Direct Pitch Ready',
      isGreenStatus: true,
    },
    {
      id: '3',
      title: 'Director of Engineering & AI',
      company: 'Enterprise Cloud SaaS',
      location: '📍 Global Remote',
      salaryRange: '$200k - $260k',
      source: 'up',
      matchScore: 88,
      tier: 'Director',
      matchedPillars: ['TypeScript / React Architecture', 'Microservices', 'CSAT 23%->68%'],
      winProbability: 'High',
      status: 'Application Sent',
      isGreenStatus: false,
    },
  ];
}
