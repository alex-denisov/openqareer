import type { RoleNamingStageFailure } from './roleNamer';

export interface RecordedRoleNamingFailure extends RoleNamingStageFailure {
  readonly at: string;
}

/**
 * Окно последних отказов ступеней называния — для администратора, не для
 * кандидата.
 *
 * Лог сервера на проде агенту недоступен: ключ выкатки выполняет три команды,
 * и `journalctl` в их числе нет. Без этого окна причина молчания головы
 * очереди остаётся недоказуемой снаружи (INC-035, B186). Окно живёт в памяти
 * процесса и теряется при рестарте — это диагностика, а не хранилище.
 */
export class RoleNamingFailureLog {
  private entries: readonly RecordedRoleNamingFailure[] = [];

  constructor(
    private readonly limit = 20,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  record(failures: readonly RoleNamingStageFailure[]): void {
    if (failures.length === 0) return;
    const at = this.now();
    this.entries = [...failures.map((failure) => ({ ...failure, at })), ...this.entries].slice(
      0,
      this.limit,
    );
  }

  recent(): RecordedRoleNamingFailure[] {
    return [...this.entries];
  }
}
