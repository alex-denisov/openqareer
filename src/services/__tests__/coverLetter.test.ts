import { describe, expect, it } from 'vitest';
import {
  generateDirectPitch,
  type TargetPlatform,
  type ToneOfVoice,
} from '../coverLetter';

const tones: ToneOfVoice[] = [
  'Executive',
  'Confident',
  'Technical',
  'Humanist',
];
const platforms: TargetPlatform[] = ['LinkedIn', 'hh.ru'];

describe('generateDirectPitch', () => {
  it.each(platforms.flatMap((platform) => tones.map((tone) => [platform, tone] as const)))(
    'returns a complete synthetic %s / %s variant',
    (platform, tone) => {
      const result = generateDirectPitch({
        companyName: 'Тестовая компания',
        targetRole: 'Тестовая роль',
        tone,
        platform,
      });

      expect(result.subjectLine).toContain('Тест');
      expect(result.pitchText.length).toBeGreaterThan(80);
      expect(result.characterCount).toBe(result.pitchText.length);
      expect(result.estimatedReadTimeSec).toBeGreaterThanOrEqual(12);
      expect(result.highlightedKeywords).toHaveLength(4);
    },
  );

  it('uses explicit neutral defaults when optional fields are absent', () => {
    const result = generateDirectPitch({
      tone: 'Executive',
      platform: 'LinkedIn',
    });

    expect(result.subjectLine).toContain('VP of Technology');
    expect(result.pitchText).toContain('Target Enterprise');
  });
});

