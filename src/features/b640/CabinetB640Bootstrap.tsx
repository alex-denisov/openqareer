import './bootstrap.css';
import { readStoredTheme } from './theme';

/**
 * B649: нейтральный первый кадр для аккаунта, которому на этом устройстве уже
 * открывался новый кабинет. Показывается, пока сервер не ответил о сессии, и
 * пока грузится корень: прежняя оболочка при этом не рисуется и не загружается.
 */
export function CabinetB640Bootstrap() {
  return (
    <div
      className="b640-boot"
      data-testid="cabinet-b640-boot"
      data-theme={readStoredTheme()}
      role="status"
      aria-busy="true"
      aria-label="Открываем кабинет"
    />
  );
}
