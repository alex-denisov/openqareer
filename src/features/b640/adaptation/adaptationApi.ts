import type { CareerDiaryOverview } from '../../../../shared/careerDiary';
import type { CareerDiaryAdaptationDetails, CareerDiaryAdaptationView } from '../../../../shared/careerDiaryCards';
import type { CareerDiaryPeopleMap, CareerDiaryPersonInput } from '../../../../shared/careerDiaryPeople';
import { apiFetch, readData } from '../../coach/apiClient';
import type {
  CareerDiaryAdaptationPlan,
  CareerDiaryWorkplaceWithPlanning,
} from '../../diary/careerDiaryPlanning';

/** Клиент маршрутов плана адаптации B684/B685 для экранов раздела (всё под флагом B640). */
const ROOT = '/api/v1/candidate/career-diary';

async function read<T>(path: string, init?: RequestInit): Promise<T> {
  return readData<T>(await apiFetch(path, init));
}

function send(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body?: unknown): RequestInit {
  const headers: Record<string, string> = { 'Idempotency-Key': crypto.randomUUID() };
  if (body === undefined) return { method, headers };
  return { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

const place = (id: string) => `${ROOT}/workplaces/${encodeURIComponent(id)}`;

export function getOverview(): Promise<CareerDiaryOverview> {
  return read(ROOT);
}

export function getWorkplace(id: string): Promise<CareerDiaryWorkplaceWithPlanning> {
  return read(place(id));
}

export interface NewWorkplace {
  readonly company: string;
  readonly title: string;
  readonly startDate: string;
}

export function createWorkplace(input: NewWorkplace): Promise<CareerDiaryWorkplaceWithPlanning> {
  return read(`${ROOT}/workplaces`, send('POST', input));
}

export function savePlan(id: string, plan: CareerDiaryAdaptationPlan): Promise<CareerDiaryWorkplaceWithPlanning> {
  return read(place(id), send('PATCH', { planning: { adaptationPlan: plan } }));
}

export function getAdaptation(id: string): Promise<CareerDiaryAdaptationView> {
  return read(`${place(id)}/adaptation`);
}

export type AdaptationPatch = Partial<Omit<CareerDiaryAdaptationDetails, 'tasks'>>;

export function patchAdaptation(id: string, patch: AdaptationPatch): Promise<CareerDiaryAdaptationView> {
  return read(`${place(id)}/adaptation`, send('PATCH', patch));
}

export function getPeople(id: string): Promise<CareerDiaryPeopleMap> {
  return read(`${place(id)}/people`);
}

export function addPerson(id: string, person: CareerDiaryPersonInput): Promise<CareerDiaryPeopleMap> {
  return read(`${place(id)}/people`, send('POST', person));
}

export function updatePerson(
  id: string,
  personId: string,
  patch: Partial<CareerDiaryPersonInput>,
): Promise<CareerDiaryPeopleMap> {
  return read(`${place(id)}/people/${encodeURIComponent(personId)}`, send('PATCH', patch));
}

export function removePerson(id: string, personId: string): Promise<CareerDiaryPeopleMap> {
  return read(`${place(id)}/people/${encodeURIComponent(personId)}`, send('DELETE'));
}

export function scheduleMeeting(id: string, personId: string, date: string): Promise<CareerDiaryPeopleMap> {
  return read(`${place(id)}/people/${encodeURIComponent(personId)}/meeting`, send('PUT', { date }));
}
