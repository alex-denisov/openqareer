import { describe, expect, it } from 'vitest';
import { checkGeneratedTextFacts } from './generatedTextFactGate';
import type { VacancyPitchInputFact } from './vacancyPitchService';

const FACTS: VacancyPitchInputFact[] = [
  {
    id: 'f1',
    kind: 'fact',
    statement: 'Scaled Fishance to $50M+ annual revenue.',
    status: 'confirmed',
    sensitive: false,
    sourceMessageIds: ['m1'],
  } as VacancyPitchInputFact,
];

const claimsOf = (text: string) => checkGeneratedTextFacts(text, FACTS).claims.map((c) => c.text);

describe('checkGeneratedTextFacts: only claims about the candidate (26.10)', () => {
  it('does not ask to confirm the letter template’s own courtesy sentences', () => {
    const letter = [
      "Hello! I'm interested in the VP of Engineering role at the Autodesk team. I'd be glad to discuss the role's scope.",
      'Autodesk is a company I want to work for.',
      "Let's set up a 15-minute call to discuss the role's scope and mutual expectations.",
      'My profile confirms hands-on experience with: Kubernetes, Go',
      'Здравствуйте! Заинтересовала роль CTO в Сбер. Буду рад обсудить задачи команды и добавить вас в сеть контактов!',
      'Предлагаю созвониться на 15 минут, чтобы предметно обсудить задачи и взаимные ожидания.',
      'Сбер — компания, в которой я хочу работать.',
    ].join('\n');
    expect(claimsOf(letter)).toEqual([]);
  });

  it('still checks the candidate facts that follow a template intro', () => {
    const claims = claimsOf(
      'My profile records the following facts: Scaled Fishance to $50M+ annual revenue. Led 300 engineers.',
    );
    expect(claims).toEqual(['Scaled Fishance to $50M+ annual revenue.', 'Led 300 engineers.']);
    expect(claimsOf('Hired 40 engineers in 2024.')).toEqual(['Hired 40 engineers in 2024.']);
    // Contact message and LinkedIn note intros (prod 26.10: 3 of 4 notices were these).
    expect(
      claimsOf(
        'My name is Alexey Denisov, reaching out regarding the SVP, Engineering role at Covera Health.\nBriefly on my background: Led 300 engineers.\nMy experience: Led 300 engineers.\nМеня зовут Алексей, пишу по поводу позиции CTO.\nКоротко о моём опыте: Led 300 engineers.',
      ),
    ).toEqual(['Led 300 engineers.', 'Led 300 engineers.', 'Led 300 engineers.']);
    const checks = checkGeneratedTextFacts(
      'My profile records the following facts: Scaled Fishance to $50M+ annual revenue.',
      FACTS,
    );
    expect(checks.status).toBe('checked');
  });
});
