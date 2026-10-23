/** Stable semantic paths for the exact roles in the prepared public catalog. */
export function salaryRolePath(role: string): string | undefined {
  return /^[a-z0-9][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(role) && role.length <= 100
    ? `/salaries/${role}`
    : undefined;
}
