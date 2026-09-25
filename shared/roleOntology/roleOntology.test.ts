import { describe, expect, it } from 'vitest';
import { ROLE_TAXONOMY } from '../roleTaxonomy';
import { ROLE_TAXONOMY_BUSINESS } from '../roleTaxonomyBusiness';
import {
  ontology,
  ontologyStats,
  validateOntology,
} from './index';

describe('role ontology', () => {
  it('contains internally consistent role and family references', () => {
    expect(validateOntology()).toEqual([]);
    expect(ontology.rolesById.size).toBe(ontology.roles.length);
    expect(ontology.familiesById.size).toBe(ontology.families.length);

    for (const role of ontology.roles) {
      expect(ontology.functionsByCode.has(role.function)).toBe(true);
      expect(ontology.familiesById.get(role.family)?.function).toBe(role.function);
      expect(role.adjacent.every((adjacent) => ontology.rolesById.has(adjacent.roleId))).toBe(true);
    }
  });

  it('uses only the runtime level scale and complete unique title variants', () => {
    const scale = new Set(['ic', 'lead', 'head', 'vp', 'c-level']);

    for (const role of ontology.roles) {
      expect(role.levels.every((level) => scale.has(level))).toBe(true);
      expect(role.variants.en.length).toBeGreaterThan(0);
      expect(role.variants.ru.length).toBeGreaterThan(0);
      expect(new Set(role.variants.en).size).toBe(role.variants.en.length);
      expect(new Set(role.variants.ru).size).toBe(role.variants.ru.length);
    }
  });

  it('covers every existing role taxonomy function without changing its codes', () => {
    const ontologyCodes = new Set(ontology.functions.map((entry) => entry.code));
    const taxonomyCodes = [
      ...ROLE_TAXONOMY,
      ...ROLE_TAXONOMY_BUSINESS,
    ].map((entry) => entry.code);

    expect(taxonomyCodes.every((code) => ontologyCodes.has(code))).toBe(true);
  });

  it('exports counts for coverage reporting', () => {
    const stats = ontologyStats();

    expect(stats.roles).toBe(ontology.roles.length);
    expect(stats.functions.eng.roles).toBeGreaterThan(0);
    expect(stats.functions.eng.variants).toBeGreaterThan(0);
  });
});
