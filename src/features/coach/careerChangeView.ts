export type CareerChangeKind = 'career.role.add' | 'career.role.remove' | 'career.conditions.update';

/** Изменение «Карьеры» в предложении консультанта (26.10). */
export interface CareerChangeView {
  roleTitle: string | null;
  locations: string[] | null;
  salaryFloorRubles: number | null;
  formats: Array<'office' | 'hybrid' | 'remote'> | null;
  relocation: boolean | null;
  stopCompanies: string[] | null;
}
