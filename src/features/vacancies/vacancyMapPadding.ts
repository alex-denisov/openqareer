const NARROW_WIDTH = 600;
/** 1440: по бокам — половина широкой капсулы и ±; снизу — заметка. */
const WIDE_PADDING = { top: 56, bottom: 96, left: 96, right: 112 };
/** 390: сверху — под ± (до 108 px) и половину капсулы; снизу — над карточкой города. */
const NARROW_PADDING = { top: 132, bottom: 132, left: 80, right: 80 };

export interface VacancyMapPadding {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/** Отступы подгонки карты к точкам выдачи по ширине контейнера. */
export function vacancyMapFitPadding(width: number): VacancyMapPadding {
  return width < NARROW_WIDTH ? NARROW_PADDING : WIDE_PADDING;
}
