import { useEffect, useState } from 'react';
import { useToast } from '../kit';
import { getResumePhoto, saveResumePhoto } from './profileExtrasApi';

interface SwitchProps {
  readonly id: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly note?: string;
}

/** «Фото в резюме» по макетам p08 и s01: `label.photo-sw > input.sw[role=switch]`. */
export function PhotoInResumeSwitch({ id, checked, onChange, disabled, note }: SwitchProps) {
  return (
    <label className="photo-sw" htmlFor={id}>
      <input
        className="sw"
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>
        <b>Фото в резюме</b>
        {note ? <small>{note}</small> : null}
      </span>
    </label>
  );
}

/**
 * Настройка с сервера; `null` — ещё читается или не прочиталась. Переключатель
 * без прочитанного значения не показываем: неверное положение хуже, чем никакого.
 */
export function useResumePhotoSetting(): boolean | null {
  const [inResume, setInResume] = useState<boolean | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    getResumePhoto(controller.signal).then(
      (setting) => setInResume(setting.inResume),
      () => undefined,
    );
    return () => controller.abort();
  }, []);
  return inResume;
}

/** s01 «Резюме под роль»: переключатель сохраняет сразу, при ошибке возвращается назад. */
export function ResumePhotoSwitch() {
  const loaded = useResumePhotoSetting();
  const [chosen, setChosen] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const checked = chosen ?? loaded;
  if (checked === null) return null;

  async function change(next: boolean) {
    setChosen(next);
    setSaving(true);
    try {
      const saved = await saveResumePhoto(next);
      setChosen(saved.inResume);
    } catch {
      setChosen(!next);
      toast.show({ text: 'Не удалось сохранить. Попробуйте ещё раз.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <PhotoInResumeSwitch
      id="cv-photo"
      checked={checked}
      disabled={saving}
      note="На hh.ru резюме с фото принято."
      onChange={(next) => void change(next)}
    />
  );
}
