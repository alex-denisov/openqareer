export interface ATSAnalysisResult {
  score: number;
  originalScore: number;
  isLifted: boolean;
  keywordMatchPercentage: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  foundMetricsCount: number;
  improvements: string[];
}

export function analyzeResumeATS(resumeText: string, targetRole: string = 'Senior Software Engineer'): ATSAnalysisResult {
  const commonTechKeywords = [
    'React', 'TypeScript', 'Node.js', 'System Architecture', 'CI/CD',
    'Docker', 'Kubernetes', 'REST API', 'GraphQL', 'Agile', 'Microservices',
    'PostgreSQL', 'Redis', 'Unit Testing', 'Performance Optimization'
  ];

  const lowerText = resumeText.toLowerCase();

  const matchedKeywords: string[] = [];
  const missingKeywords: string[] = [];

  commonTechKeywords.forEach((kw) => {
    if (lowerText.includes(kw.toLowerCase())) {
      matchedKeywords.push(kw);
    } else {
      missingKeywords.push(kw);
    }
  });

  // Calculate base score
  const keywordScore = Math.round((matchedKeywords.length / commonTechKeywords.length) * 60);

  // Check metrics & numbers
  const numberRegex = /\d+(%|\+|\s?k|\s?m|\s?years|\s?users|\s?team)/gi;
  const metricsMatches = resumeText.match(numberRegex) || [];
  const metricsScore = Math.min(20, metricsMatches.length * 4);

  // Check section structure
  let structureScore = 10;
  if (lowerText.includes('experience') || lowerText.includes('work')) structureScore += 5;
  if (lowerText.includes('education') || lowerText.includes('skills')) structureScore += 5;

  const totalRawScore = Math.min(94, Math.max(45, keywordScore + metricsScore + structureScore));

  const improvements: string[] = [];
  if (missingKeywords.length > 0) {
    improvements.push(`Add missing key terms: ${missingKeywords.slice(0, 4).join(', ')}`);
  }
  if (metricsMatches.length < 3) {
    improvements.push('Quantify impact metrics (e.g., increased performance by 30%, led team of 6)');
  }

  return {
    score: totalRawScore,
    originalScore: totalRawScore,
    isLifted: false,
    keywordMatchPercentage: Math.round((matchedKeywords.length / commonTechKeywords.length) * 100),
    matchedKeywords,
    missingKeywords,
    foundMetricsCount: metricsMatches.length,
    improvements,
  };
}
