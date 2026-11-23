import { ontology, type RoleForms } from '../../shared/roleOntology';

const keyOf = (title: string): string => title.trim().toLocaleLowerCase('ru');

function buildIndex(): ReadonlyMap<string, RoleForms | null> {
  const index = new Map<string, RoleForms | null>();
  for (const role of ontology.roles) {
    const forms = role.forms ?? null;
    const names = [role.titleEn, role.titleRu, ...role.variants.en, ...role.variants.ru];
    for (const key of new Set(names.map(keyOf))) {
      const known = index.get(key);
      // Название, общее с другой ролью с иными формами или без них, двусмысленно — форм нет.
      index.set(key, known === undefined || known === forms ? forms : null);
    }
  }
  return index;
}

const INDEX = buildIndex();

/**
 * B669: падежные формы целевой профессии по словарю ролей. Профессия кандидата —
 * свободный текст; без форм в словаре экран пути оставляет общие тексты.
 */
export function professionForms(target: string): RoleForms | null {
  return INDEX.get(keyOf(target)) ?? null;
}
