/**
 * B382: путь удаления одной находки цифрового следа — кандидат отметил, что
 * отправил запрос владельцу площадки, и повторно проверил адрес находки.
 */
export type FootprintRemovalResult = 'removed' | 'still_there' | 'unclear';

export interface FootprintRemoval {
  /** Когда кандидат отметил «Письмо отправлено». */
  readonly requestedAt?: string;
  /** Последняя проверка адреса находки и её итог. */
  readonly checkedAt?: string;
  readonly result?: FootprintRemovalResult;
}
