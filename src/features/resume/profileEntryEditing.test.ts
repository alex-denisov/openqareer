import { describe, expect, it } from 'vitest';
import {
  addAchievement,
  addCertification,
  addProject,
  removeAchievement,
  removeCertification,
  removeProject,
  updateAbout,
  updateAchievement,
  updateCertification,
  updateCourse,
  updateProject,
  updateRecommendation,
} from './profileEntryEditing';
import type { ResumeDraft } from './resumeTypes';

const base: ResumeDraft = {
  candidate: { about: 'Старый текст' },
  experience: [],
  education: [],
  languages: [],
};

describe('updateAbout', () => {
  it('replaces the about text without touching other candidate fields', () => {
    const next = updateAbout({ ...base, candidate: { ...base.candidate, fullName: 'A' } }, 'Новый текст');
    expect(next.candidate.about).toBe('Новый текст');
    expect(next.candidate.fullName).toBe('A');
  });
});

describe('certifications', () => {
  it('adds, updates and removes a certification immutably', () => {
    const withOne = addCertification(base);
    expect(withOne.certifications).toHaveLength(1);
    expect(base.certifications ?? []).toHaveLength(0);

    const id = withOne.certifications![0].id;
    const updated = updateCertification(withOne, id, { name: 'AWS Certified' });
    expect(updated.certifications![0].name).toBe('AWS Certified');
    expect(withOne.certifications![0].name).toBe('');

    const removed = removeCertification(updated, id);
    expect(removed.certifications).toHaveLength(0);
  });
});

describe('projects', () => {
  it('adds, updates and removes a project immutably', () => {
    const withOne = addProject(base);
    const id = withOne.projects![0].id;
    const updated = updateProject(withOne, id, { name: 'Payments Core Migration' });
    expect(updated.projects![0].name).toBe('Payments Core Migration');
    expect(removeProject(updated, id).projects).toHaveLength(0);
  });
});

describe('achievements', () => {
  it('adds with a default kind, updates and removes immutably', () => {
    const withOne = addAchievement(base);
    expect(withOne.achievements![0].kind).toBe('honor');
    const id = withOne.achievements![0].id;
    const updated = updateAchievement(withOne, id, { title: 'Fintech Leader of the Year' });
    expect(updated.achievements![0].title).toBe('Fintech Leader of the Year');
    expect(removeAchievement(updated, id).achievements).toHaveLength(0);
  });
});

describe('updateCourse / updateRecommendation', () => {
  it('updates an existing course by id', () => {
    const draft: ResumeDraft = { ...base, courses: [{ id: 'course-1', name: 'Old' }] };
    const next = updateCourse(draft, 'course-1', { name: 'New' });
    expect(next.courses![0].name).toBe('New');
  });

  it('updates an existing recommendation by id', () => {
    const draft: ResumeDraft = {
      ...base,
      recommendations: [{ id: 'rec-1', recommender: 'Old Name' }],
    };
    const next = updateRecommendation(draft, 'rec-1', { recommender: 'New Name' });
    expect(next.recommendations![0].recommender).toBe('New Name');
  });
});
