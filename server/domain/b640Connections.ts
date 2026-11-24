import type { B640Connection, B640ConnectionList } from '../../shared/b640Connections';
import type { B640ContactSource } from './b640Contacts';
import { candidateCompanyKey } from './candidateCompanies';
import { cleanPersonName, plausibleCompanyName, shortRoleTitle } from './contactDisplay';

/** Вакансия подборки: компания и id, к которому ведёт письмо. */
export interface SelectionVacancy {
  readonly id: string;
  readonly companyName: string;
}

/** Рекрутер вакансии подборки: без почты и телефона. */
export interface SelectionRecruiter {
  readonly id: string;
  readonly vacancyId: string;
  readonly fullName: string;
  readonly roleTitle: string;
}

export interface B640ConnectionInput {
  readonly contacts: readonly B640ContactSource[];
  readonly vacancies: readonly SelectionVacancy[];
  readonly recruiters: readonly SelectionRecruiter[];
  readonly selectionPending: boolean;
  readonly linkedinImport: B640ConnectionList['linkedinImport'];
}

export interface B640ConnectionQuery {
  readonly offset: number;
  readonly limit: number;
  readonly search: string;
  readonly pool: boolean;
}

interface SelectionCompany {
  readonly name: string;
  readonly vacancyIds: readonly string[];
}

type Selection = ReadonlyMap<string, SelectionCompany>;

const fold = (value: string): string => value.toLocaleLowerCase('ru-RU');
const personName = (raw: string): string => cleanPersonName(raw) || raw.trim();

function selectionCompanies(vacancies: readonly SelectionVacancy[]): Selection {
  const companies = new Map<string, SelectionCompany>();
  for (const vacancy of vacancies) {
    const name = vacancy.companyName.trim();
    if (!name) continue;
    const key = candidateCompanyKey(name);
    const known = companies.get(key);
    companies.set(key, {
      name: known?.name ?? name,
      vacancyIds: [...(known?.vacancyIds ?? []), vacancy.id],
    });
  }
  return companies;
}

function contactTarget(contactId: string, vacancyIds: readonly string[]) {
  const [first, second] = vacancyIds;
  return {
    contactId,
    ...(first ? { vacancyId: first } : {}),
    ...(first && second ? { alsoVacancyId: second } : {}),
  };
}

function directRows(input: B640ConnectionInput, selection: Selection): B640Connection[] {
  // Написание компании в контактах разное: в группе одно имя — из подборки или первое встреченное.
  const names = new Map<string, string>();
  return input.contacts.map((contact) => {
    const plain = plausibleCompanyName(contact.companyName);
    const key = plain ? candidateCompanyKey(plain) : '';
    const company = key ? selection.get(key) : undefined;
    if (key && !names.has(key)) names.set(key, company?.name ?? plain);
    const vacancyIds = company?.vacancyIds ?? [];
    return {
      id: `contact:${contact.id}`,
      fullName: personName(contact.fullName),
      roleTitle: shortRoleTitle(contact.roleTitle),
      companyName: names.get(key) ?? '',
      inSelection: company !== undefined,
      vacancyId: vacancyIds[0] ?? null,
      circle: 1,
      via: null,
      message: { kind: 'known_contact', target: contactTarget(contact.id, vacancyIds) },
    };
  });
}

/** Кто из связей знает рекрутера: id рекрутера → первая такая связь. */
function introducersOf(contacts: readonly B640ContactSource[]): Map<string, B640ContactSource> {
  const result = new Map<string, B640ContactSource>();
  for (const contact of contacts) {
    for (const id of contact.knowsRecruiterIds) {
      if (!result.has(id)) result.set(id, contact);
    }
  }
  return result;
}

const identity = (company: string, name: string): string => `${company}\u0000${fold(name)}`;

/** 2-й круг: рекрутеры вакансий подборки, которых знает связь кандидата. Черновик — знакомому. */
function introductionRows(
  input: B640ConnectionInput,
  selection: Selection,
  direct: readonly B640Connection[],
): B640Connection[] {
  const companyOf = new Map(
    input.vacancies.map((vacancy) => [vacancy.id, candidateCompanyKey(vacancy.companyName)]),
  );
  const introducers = introducersOf(input.contacts);
  const known = new Set(direct.map((row) => identity(row.companyName, row.fullName)));
  const rows: B640Connection[] = [];
  for (const recruiter of input.recruiters) {
    const company = selection.get(companyOf.get(recruiter.vacancyId) ?? '');
    const via = introducers.get(recruiter.id);
    if (!company || !via) continue;
    const fullName = personName(recruiter.fullName);
    if (known.has(identity(company.name, fullName))) continue;
    known.add(identity(company.name, fullName));
    rows.push({
      id: `recruiter:${recruiter.id}`,
      fullName,
      roleTitle: shortRoleTitle(recruiter.roleTitle),
      companyName: company.name,
      inSelection: true,
      vacancyId: recruiter.vacancyId,
      circle: 2,
      via: personName(via.fullName),
      message: { kind: 'ask_introduction', target: contactTarget(via.id, [recruiter.vacancyId]) },
    });
  }
  return rows;
}

const compareRows = (a: B640Connection, b: B640Connection): number =>
  Number(b.inSelection) - Number(a.inSelection) ||
  Number(a.companyName === '') - Number(b.companyName === '') ||
  a.companyName.localeCompare(b.companyName, 'ru-RU') ||
  a.circle - b.circle ||
  a.fullName.localeCompare(b.fullName, 'ru-RU') ||
  a.id.localeCompare(b.id);

/** Связи по компаниям: сначала компании подборки, внутри компании — сначала 1-й круг. */
export function buildB640Connections(
  input: B640ConnectionInput,
  query: B640ConnectionQuery,
): B640ConnectionList {
  const selection = selectionCompanies(input.vacancies);
  const direct = directRows(input, selection);
  const rows = [...direct, ...introductionRows(input, selection, direct)];
  const needle = fold(query.search.trim());
  const found = rows
    .filter((row) => !query.pool || row.inSelection)
    .filter((row) => [row.fullName, row.companyName].some((text) => fold(text).includes(needle)))
    .sort(compareRows);
  const items = found.slice(query.offset, query.offset + query.limit);
  const shown = query.offset + items.length;
  return {
    items,
    total: found.length,
    connections: direct.length,
    selectionCompanies: new Set(
      rows.filter((row) => row.inSelection).map((row) => row.companyName),
    ).size,
    selectionPending: input.selectionPending,
    offset: query.offset,
    nextOffset: shown < found.length ? shown : null,
    linkedinImport: input.linkedinImport,
  };
}
