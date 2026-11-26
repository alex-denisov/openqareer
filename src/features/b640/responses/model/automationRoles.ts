export interface AutomationRoleOption {
  readonly value: string;
  readonly label: string;
}

/** Роли листа a04e: выбранные в правилах и роли поиска; снятая роль из списка не пропадает. */
export function automationRoleOptions(
  ruleRoles: readonly string[],
  searchRoles: readonly string[],
  titlesRu: Readonly<Record<string, string>> = {},
): readonly AutomationRoleOption[] {
  const byKey = new Map(
    [...searchRoles, ...ruleRoles].map((role) => [role.trim().toLowerCase(), role] as const),
  );
  const order = [...new Set([...ruleRoles, ...searchRoles].map((role) => role.trim().toLowerCase()))];
  return order.map((key) => {
    const value = byKey.get(key)!;
    return { value, label: titlesRu[value] ?? value };
  });
}
