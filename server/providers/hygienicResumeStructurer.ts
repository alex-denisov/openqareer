import { sanitizeHiddenMarkersDeep } from '../../shared/textHygiene';
import type { ParsedResume } from '../../src/features/workspace/resumeParser';
import type { ResumeStructurer } from './resumeStructurer';

/**
 * Разобранное моделью резюме доходит до кандидата без невидимых меток (B210).
 *
 * ПОЧЕМУ ОТДЕЛЬНО ОТ ХОДА КОНСУЛЬТАНТА. `HygienicCoachProvider` стоит на
 * очереди ходов, а резюме структурирует другой вызов модели — узкий, со своей
 * очередью и своим потолком ожидания (INC-037). Мимо чистки хода он проходит
 * целиком, а его текст живёт дольше любого ответа консультанта: кандидат
 * правит его в «Студии резюме» и уносит в отклики, то есть метка уезжает в
 * ATS работодателя.
 *
 * Молчание модели остаётся молчанием: `null` — законный ответ, и подменять его
 * пустым резюме нельзя, иначе разбор правилами не получит своей очереди.
 */
export class HygienicResumeStructurer implements ResumeStructurer {
  /** Открыт наружу, чтобы сборка могла назвать, что именно она обернула. */
  readonly inner: ResumeStructurer;

  constructor(options: { inner: ResumeStructurer }) {
    this.inner = options.inner;
  }

  async structure(sourceText: string): Promise<ParsedResume | null> {
    const parsed = await this.inner.structure(sourceText);
    if (parsed === null) return null;
    return sanitizeHiddenMarkersDeep(parsed);
  }
}
