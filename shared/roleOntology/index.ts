import metaData from './meta.json';
import functionsData from './functions.json';
import eng from './functions/eng.json';
import engMgmt from './functions/eng-mgmt.json';
import itOps from './functions/it-ops.json';
import data from './functions/data.json';
import aiMl from './functions/ai-ml.json';
import security from './functions/security.json';
import qa from './functions/qa.json';
import product from './functions/product.json';
import design from './functions/design.json';
import ops from './functions/ops.json';
import sales from './functions/sales.json';
import bizdev from './functions/bizdev.json';
import marketing from './functions/marketing.json';
import pr from './functions/pr.json';
import support from './functions/support.json';
import finance from './functions/finance.json';
import auditRisk from './functions/audit-risk.json';
import hr from './functions/hr.json';
import legal from './functions/legal.json';
import procurement from './functions/procurement.json';
import logistics from './functions/logistics.json';
import manufacturing from './functions/manufacturing.json';
import retail from './functions/retail.json';
import hospitality from './functions/hospitality.json';
import agriculture from './functions/agriculture.json';
import healthcare from './functions/healthcare.json';
import education from './functions/education.json';
import consulting from './functions/consulting.json';
import projectMgmt from './functions/project-mgmt.json';
import research from './functions/research.json';
import execGeneral from './functions/exec-general.json';
import admin from './functions/admin.json';
import realEstate from './functions/real-estate.json';
import construction from './functions/construction.json';
import media from './functions/media.json';
import personalServices from './functions/personal-services.json';
import elementaryLabor from './functions/elementary-labor.json';
import securityServices from './functions/security-services.json';
import publicService from './functions/public-service.json';
import defense from './functions/defense.json';
import artsCulture from './functions/arts-culture.json';
import extractionEnergy from './functions/extraction-energy.json';
import other from './functions/other.json';

export const ONTOLOGY_LEVELS = ['ic', 'lead', 'head', 'vp', 'c-level'] as const;

export type OntologyLevel = (typeof ONTOLOGY_LEVELS)[number];
export interface RoleFunction {
  readonly code: string;
  readonly labelEn: string;
  readonly labelRu: string;
}
export interface RoleFamily {
  readonly id: string;
  readonly function: string;
  readonly labelEn: string;
  readonly labelRu: string;
  readonly coverage: string;
}
export interface Role {
  readonly id: string;
  readonly function: string;
  readonly family: string;
  readonly titleEn: string;
  readonly titleRu: string;
  /** Проверяется при загрузке: JSON остаётся источником данных, а не TS-кодом. */
  readonly levels: readonly string[];
  readonly variants: Readonly<{ en: readonly string[]; ru: readonly string[] }>;
  readonly adjacent: readonly Readonly<{ roleId: string; kind: string }>[];
  readonly icBand?: readonly string[];
  readonly qualificationBand?: readonly string[];
}

interface FunctionData {
  readonly families: readonly RoleFamily[];
  readonly roles: readonly Role[];
}

const functionData: readonly FunctionData[] = [
  eng, engMgmt, itOps, data, aiMl, security, qa, product, design, ops, sales,
  bizdev, marketing, pr, support, finance, auditRisk, hr, legal, procurement,
  logistics, manufacturing, retail, hospitality, agriculture, healthcare,
  education, consulting, projectMgmt, research, execGeneral, admin, realEstate,
  construction, media, personalServices, elementaryLabor, securityServices,
  publicService, defense, artsCulture, extractionEnergy, other,
];

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function groupRoles(roles: readonly Role[], key: (role: Role) => string): ReadonlyMap<string, readonly Role[]> {
  const groups = new Map<string, readonly Role[]>();
  for (const role of roles) groups.set(key(role), [...(groups.get(key(role)) ?? []), role]);
  return groups;
}

const functions = freeze([...functionsData] as RoleFunction[]);
const families = freeze(functionData.flatMap((entry) => entry.families));
const roles = freeze(functionData.flatMap((entry) => entry.roles));

export const ontology = freeze({
  meta: metaData.meta,
  levelRules: metaData.levelRules,
  iscoCrossCheck: metaData.iscoCrossCheck,
  functions,
  families,
  roles,
  functionsByCode: new Map(functions.map((entry) => [entry.code, entry])),
  familiesById: new Map(families.map((entry) => [entry.id, entry])),
  rolesById: new Map(roles.map((entry) => [entry.id, entry])),
  rolesByFunction: groupRoles(roles, (role) => role.function),
  rolesByFamily: groupRoles(roles, (role) => role.family),
});

export function validateOntology(): readonly string[] {
  const errors: string[] = [];
  const levels = new Set<string>(ONTOLOGY_LEVELS);

  if (ontology.functionsByCode.size !== ontology.functions.length) errors.push('Duplicate function code');
  if (ontology.familiesById.size !== ontology.families.length) errors.push('Duplicate family id');
  if (ontology.rolesById.size !== ontology.roles.length) errors.push('Duplicate role id');

  for (const family of ontology.families) {
    if (!ontology.functionsByCode.has(family.function)) errors.push(`Unknown function for family ${family.id}`);
  }
  for (const role of ontology.roles) {
    if (!ontology.functionsByCode.has(role.function)) errors.push(`Unknown function for role ${role.id}`);
    if (!ontology.familiesById.has(role.family)) errors.push(`Unknown family for role ${role.id}`);
    if (ontology.familiesById.get(role.family)?.function !== role.function) {
      errors.push(`Family belongs to another function for role ${role.id}`);
    }
    if (!role.levels.every((level) => levels.has(level))) errors.push(`Invalid level for role ${role.id}`);
    if (role.variants.en.length === 0 || role.variants.ru.length === 0) errors.push(`Missing variants for role ${role.id}`);
    if (new Set(role.variants.en).size !== role.variants.en.length) errors.push(`Duplicate EN variant for role ${role.id}`);
    if (new Set(role.variants.ru).size !== role.variants.ru.length) errors.push(`Duplicate RU variant for role ${role.id}`);
    for (const adjacent of role.adjacent) {
      if (!ontology.rolesById.has(adjacent.roleId)) errors.push(`Unknown adjacent role ${adjacent.roleId} for ${role.id}`);
    }
  }
  return errors;
}

export function ontologyStats(): Readonly<{
  roles: number;
  variants: number;
  functions: Readonly<Record<string, Readonly<{ roles: number; variants: number }>>>;
}> {
  const byFunction = Object.fromEntries(ontology.functions.map((entry) => {
    const functionRoles = ontology.rolesByFunction.get(entry.code) ?? [];
    const variants = functionRoles.reduce((total, role) => total + role.variants.en.length + role.variants.ru.length, 0);
    return [entry.code, freeze({ roles: functionRoles.length, variants })];
  }));
  const variants = Object.values(byFunction).reduce((total, entry) => total + entry.variants, 0);
  return freeze({ roles: ontology.roles.length, variants, functions: byFunction });
}
