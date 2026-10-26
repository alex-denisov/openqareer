import { PRIVATE_EMPLOYER, publicEmployerName } from '../../shared/privateEmployer';

interface EmployerCluster {
  readonly canonicalCompany: string;
  readonly employerIsPerson?: boolean;
}

/** Работодатель — частное лицо: признак площадки или форма ФИО (INC-023). */
export function isPrivateEmployerCluster(cluster: EmployerCluster): boolean {
  return publicEmployerName(cluster.canonicalCompany, cluster.employerIsPerson) === PRIVATE_EMPLOYER;
}

/**
 * CPO 26.10: кабинет, как публичный каталог (#100), не показывает ФИО
 * работодателя. Имя заменяется до ответа, поэтому в клиент оно не уходит.
 */
export function maskPrivateEmployers<T extends { readonly cluster: EmployerCluster }>(
  items: readonly T[],
): T[] {
  return items.map((item) =>
    isPrivateEmployerCluster(item.cluster)
      ? {
          ...item,
          cluster: { ...item.cluster, canonicalCompany: PRIVATE_EMPLOYER, employerIsPerson: true },
        }
      : item,
  );
}
