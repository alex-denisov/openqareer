import type { FunctionCode } from '../../../shared/roleTaxonomy';

export interface Top20RelevanceFixture {
  readonly title: string;
  readonly titleKey: string;
  readonly source: 'C28' | 'title_key';
  readonly relevant: boolean;
  readonly reason: string;
  readonly functions: readonly FunctionCode[];
  readonly levelRank: number | null;
}

const c28 = (title: string, relevant: boolean, reason: string, functions: readonly FunctionCode[], levelRank: number | null): Top20RelevanceFixture => ({
  title,
  titleKey: title.toLowerCase(),
  source: 'C28',
  relevant,
  reason,
  functions,
  levelRank,
});

const productionTitle = (titleKey: string, functions: readonly FunctionCode[], levelRank: number): Top20RelevanceFixture => ({
  title: titleKey,
  titleKey,
  source: 'title_key',
  relevant: true,
  reason: 'Executive Tech/Ops role from production title_parse; a matching profile fact is seeded.',
  functions,
  levelRank,
});

/**
 * B245 golden set: the first 20 titles are reproduced from C28, and the next
 * 20 are exact title_key values read with SELECT from production title_parse
 * on 2026-09-27. It deliberately contains no fixture reads from ignored docs.
 */
export const TOP20_RELEVANCE_GOLDEN_SET: readonly Top20RelevanceFixture[] = [
  c28('Chief Operating Officer', true, 'C-level operations role with matching facts.', ['ops'], 4),
  c28('VP of Engineering', true, 'VP technology role with matching facts.', ['eng-mgmt'], 3),
  c28('Software Engineer, Infrastructure — Self Managed Experience', false, 'Individual engineering role below VP.', ['eng', 'it-ops'], 0),
  c28('VP of Channel Sales — GFI Software', false, 'Sales is not the target function.', ['sales'], 3),
  c28('SVP of Technical Product Management — 2 Hour Learning', false, 'Product is adjacent, not Tech/Ops executive.', ['product', 'education'], 3),
  c28('SVP of Student Operations & Systems — 2 Hour Learning', false, 'Education operations is not the target Tech/Ops family.', ['ops', 'education'], 3),
  c28('VP of PMO — 2 Hour Learning', false, 'PMO is not the target Tech/Ops executive family.', ['project-mgmt', 'education'], 3),
  c28('AI Professional Services Engineer I — Quark', false, 'Engineer I is an individual contributor.', ['eng', 'ai-ml'], 0),
  c28('Chief Financial Officer — Trilogy', false, 'Finance is not the target function.', ['finance'], 4),
  c28('Contract Writer — A Book Exploring the Beauty and Meaning of Sacred Art', false, 'Writing is not the target function.', [], 0),
  c28('National Board of Trustees / Conseil d’administration national', false, 'Board membership is not an operating role.', [], 0),
  c28('Senior Front End Software Developer — Remote US', false, 'Senior IC development is below VP.', ['eng'], 0),
  c28('Professional Consultant für digitale Verwaltungsprojekte', false, 'Public-sector consulting is not the target executive family.', ['consulting'], 0),
  c28('Nonprofit Evaluator — Program Specialist', false, 'Neither function nor level is target.', ['other'], 0),
  c28('Head of Digital Marketing', false, 'Marketing is not the target function.', ['marketing'], 2),
  c28('Lead Software Architect', false, 'Hands-on architecture is below VP.', ['eng'], 1),
  c28('Senior Mobile Software Architect', false, 'Hands-on architecture is below VP.', ['eng'], 0),
  c28('Director of Supply Chain', false, 'Supply chain is adjacent operations, not Tech/Ops.', ['logistics'], 2),
  c28('CX Technology, Engineering & Product Professionals', false, 'A professional group is not an executive vacancy.', ['product'], 0),
  c28('Director of AI', false, 'Adjacent technology function below VP.', ['ai-ml'], 2),
  productionTitle('chief information officer', ['it-ops'], 4),
  productionTitle('chief information officer en directeur informatievoorziening', ['it-ops'], 4),
  productionTitle('chief information officer/program lead', ['it-ops'], 4),
  productionTitle('chief operating officer', ['ops'], 4),
  productionTitle('chief operating officer , key management personnel', ['ops'], 4),
  productionTitle('chief operating officer / vice president', ['ops'], 4),
  productionTitle('chief operating officer – volta cafe', ['ops'], 4),
  productionTitle('chief operating officer, a&h', ['ops'], 4),
  productionTitle('chief technology officer', ['eng-mgmt'], 4),
  productionTitle('chief technology officer / cto / технический директор', ['eng-mgmt'], 4),
  productionTitle('chief technology officer / head of engineering', ['eng-mgmt'], 4),
  productionTitle('chief technology officer / technical co-founder', ['eng-mgmt'], 4),
  productionTitle('chief technology officer – ai agent platforms', ['eng-mgmt', 'ai-ml'], 4),
  productionTitle('chief technology officer – cto', ['eng-mgmt'], 4),
  productionTitle('chief technology officer, cto / technical co-founder', ['eng-mgmt'], 4),
  productionTitle('chief technology officer/cto igaming', ['eng-mgmt'], 4),
  productionTitle('cto / chief technology officer', ['eng-mgmt'], 4),
  productionTitle('defense enterprise chief technology officer', ['eng-mgmt'], 4),
  productionTitle('founding chief technology officer', ['eng-mgmt'], 4),
  productionTitle('fractional chief technology officer', ['eng-mgmt'], 4),
];
