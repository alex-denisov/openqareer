//! B642: деление дорожки на сегменты по 10 минут времени записи.
//!
//! Часы ведутся по метке времени сэмпла (PTS), а не по часам компьютера:
//! дорожка режется ровно по звуку, даже если очередь обработки отстала.

/// Длина сегмента: ≈ 2,4 МБ AAC 32 кбит/с, с запасом ниже лимита сервера 25 МБ.
pub const SEGMENT_SECONDS: f64 = 600.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ClockStep {
    /// Первый сэмпл сегмента `index`: открыть файл.
    Open { index: u32 },
    /// Сэмпл того же сегмента.
    Continue,
    /// Сегмент `finished` закрыт этим сэмплом; он же открывает сегмент `next`.
    Rotate { finished: u32, next: u32 },
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SegmentClock {
    current: Option<(u32, f64)>,
    last_pts: f64,
}

impl SegmentClock {
    pub fn on_sample(&mut self, pts_seconds: f64) -> ClockStep {
        let step = match self.current {
            None => {
                self.current = Some((0, pts_seconds));
                ClockStep::Open { index: 0 }
            }
            Some((index, start)) if pts_seconds - start >= SEGMENT_SECONDS => {
                self.current = Some((index + 1, pts_seconds));
                ClockStep::Rotate {
                    finished: index,
                    next: index + 1,
                }
            }
            Some(_) => ClockStep::Continue,
        };
        self.last_pts = pts_seconds;
        step
    }

    /// Номер открытого сегмента и его длина в мс по последнему сэмплу.
    pub fn open_segment(&self) -> Option<(u32, u64)> {
        self.current
            .map(|(index, start)| (index, duration_ms(start, self.last_pts)))
    }
}

pub fn duration_ms(start: f64, end: f64) -> u64 {
    ((end - start).max(0.0) * 1000.0).round() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_sample_opens_segment_zero() {
        let mut clock = SegmentClock::default();
        assert_eq!(clock.on_sample(12.0), ClockStep::Open { index: 0 });
        assert_eq!(clock.on_sample(13.0), ClockStep::Continue);
        assert_eq!(clock.open_segment(), Some((0, 1000)));
    }

    #[test]
    fn ten_minutes_of_audio_rotate_to_the_next_segment() {
        let mut clock = SegmentClock::default();
        clock.on_sample(100.0);
        assert_eq!(clock.on_sample(699.9), ClockStep::Continue);
        assert_eq!(
            clock.on_sample(700.0),
            ClockStep::Rotate {
                finished: 0,
                next: 1
            }
        );
        assert_eq!(clock.on_sample(1299.0), ClockStep::Continue);
        assert_eq!(
            clock.on_sample(1300.0),
            ClockStep::Rotate {
                finished: 1,
                next: 2
            }
        );
    }

    #[test]
    fn no_samples_means_no_open_segment() {
        assert_eq!(SegmentClock::default().open_segment(), None);
    }

    #[test]
    fn duration_never_goes_negative() {
        assert_eq!(duration_ms(10.0, 9.0), 0);
        assert_eq!(duration_ms(0.0, 1.2345), 1235);
    }
}
