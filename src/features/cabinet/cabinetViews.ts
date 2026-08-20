/**
 * The cabinet's five sections, kept in their own module so a view component can
 * name the type without importing the container it is rendered by.
 */
export type CareerCabinetView =
  | 'today'
  | 'profile'
  | 'resume'
  | 'career'
  | 'opportunities';
