/** B791: строки раскрытой вакансии из её текста. */
export interface VacancyBrief {
  readonly duties: readonly string[];
  readonly requirements: readonly string[];
  /** Условия строками текста; в строке подборки не показываются. */
  readonly conditions?: readonly string[];
  /** Первые предложения: показываются, когда разделов в тексте нет. */
  readonly opening: string;
}
