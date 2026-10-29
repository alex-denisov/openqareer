// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { VacancyFitView } from '../../../shared/vacancyFit';
import {
  dismissQuizOffer,
  isQuizOfferDismissed,
  quizOfferSkills,
  quizOfferTitle,
} from './vacancyQuizOffer';

function requirement(
  id: string,
  text: string,
  importance: 'critical' | 'high' | 'medium' | 'low',
  kind: 'experience' | 'language' | 'other' = 'other',
) {
  return {
    id,
    text,
    sourceQuote: text,
    origin: 'description',
    importance,
    kind,
    hard: false,
    stopFactor: false,
  };
}

function view(matched: readonly string[]): VacancyFitView {
  return {
    state: 'ready',
    requirements: [
      requirement('r1', 'Платёжные системы', 'critical'),
      requirement('r2', 'Kubernetes', 'medium'),
      requirement('r3', 'Английский B2', 'critical', 'language'),
      requirement('r4', 'Kafka', 'high'),
      requirement('r5', 'Terraform', 'low'),
    ],
    result: {
      assessments: matched.map((requirementId) => ({
        requirementId,
        status: 'matched',
        checked: true,
      })),
    },
  } as unknown as VacancyFitView;
}

describe('quizOfferSkills', () => {
  it('offers only labelled skills, never experience or a sentence (B510)', () => {
    const long = 'Proven track record as a senior engineering leader with ownership of direction';
    const offer = {
      state: 'ready',
      requirements: [
        { ...requirement('a', long, 'critical'), skill: false },
        { ...requirement('b', '10+ years in leadership roles', 'critical', 'experience') },
        {
          ...requirement('c', 'Deep Kafka experience in production', 'high'),
          label: 'Kafka',
          skill: true,
        },
      ],
      result: { assessments: [] },
    } as unknown as VacancyFitView;
    expect(quizOfferSkills(offer)).toEqual(['Kafka']);
  });

  it('names up to two unconfirmed skills, most important first, without languages', () => {
    expect(quizOfferSkills(view(['r1']))).toEqual(['Kafka', 'Kubernetes']);
  });

  it('is empty without a fit view or when every skill is confirmed', () => {
    expect(quizOfferSkills(undefined)).toEqual([]);
    expect(quizOfferSkills(view(['r1', 'r2', 'r4', 'r5']))).toEqual([]);
  });

  it('builds the mockup title', () => {
    expect(quizOfferTitle(['Kafka', 'Kubernetes'])).toBe('Пройти квиз по Kafka и Kubernetes');
    expect(quizOfferTitle(['Kafka'])).toBe('Пройти квиз по Kafka');
  });
});

describe('«Не сейчас»', () => {
  beforeEach(() => localStorage.clear());

  it('hides the offer for this vacancy across reloads', () => {
    dismissQuizOffer('v1', ['Kafka', 'Kubernetes']);
    expect(isQuizOfferDismissed('v1', ['Kafka', 'Kubernetes'])).toBe(true);
    expect(isQuizOfferDismissed('v2', ['Kafka', 'Kubernetes'])).toBe(false);
  });

  it('returns when a new unconfirmed skill appears', () => {
    dismissQuizOffer('v1', ['Kafka', 'Kubernetes']);
    expect(isQuizOfferDismissed('v1', ['Kafka'])).toBe(true);
    expect(isQuizOfferDismissed('v1', ['Kafka', 'Terraform'])).toBe(false);
  });
});

describe('quizOfferTitle phrases (G5 W3/R1)', () => {
  it('does not decline multi-word skill names after «по»', () => {
    expect(quizOfferTitle(['Управление командой', 'AI'])).toBe(
      'Пройти квиз по навыкам: Управление командой и AI',
    );
  });
});

describe('quizOfferSkills after half credit (owner 29.10)', () => {
  it('names stated but unchecked skills before missing ones', () => {
    const stated = view(['r1']);
    const withStated = {
      ...stated,
      result: {
        ...stated.result!,
        assessments: [
          ...stated.result!.assessments,
          { requirementId: 'r5', status: 'matched', evidence: [] },
        ],
      },
    } as VacancyFitView;
    expect(quizOfferSkills(withStated)).toEqual(['Terraform', 'Kafka']);
  });
});
