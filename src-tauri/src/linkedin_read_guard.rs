//! Reading pace for the candidate's own LinkedIn session, enforced in Rust
//! (B266 security WARN: the limits lived only in the web layer, so any script
//! in the app could drive the session as fast as it liked).
//!
//! Every read waits until `MIN_READ_GAP` has passed since the previous one,
//! and details/overlay pages are capped at `MAX_DETAIL_READS` per rolling
//! `DETAIL_WINDOW`. The state lives in the process, like the session window.

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const MIN_READ_GAP: Duration = Duration::from_secs(3);
/// Seven details pages plus the contact-info overlay (linkedinSessionPoll.ts).
pub const MAX_DETAIL_READS: usize = 8;
pub const DETAIL_WINDOW: Duration = Duration::from_secs(12 * 60 * 60);

#[derive(Debug, Default)]
pub struct LinkedInReadGuard {
    last_read: Option<Instant>,
    detail_reads: VecDeque<Instant>,
}

#[derive(Debug, Default)]
pub struct LinkedInReadGuardState(pub Mutex<LinkedInReadGuard>);

/// A profile section page (`/details/…`) or the contact-info overlay.
pub fn is_detail_page(path: &str) -> bool {
    path.contains("/details/") || path.contains("/overlay/")
}

impl LinkedInReadGuard {
    /// Admits one read at `now` and returns how long to wait before it, or
    /// refuses a details page once the window's budget is spent.
    pub fn admit(&mut self, now: Instant, detail: bool) -> Result<Duration, &'static str> {
        while self
            .detail_reads
            .front()
            .is_some_and(|read| now.saturating_duration_since(*read) >= DETAIL_WINDOW)
        {
            self.detail_reads.pop_front();
        }
        if detail && self.detail_reads.len() >= MAX_DETAIL_READS {
            return Err("linkedin_detail_budget_exhausted");
        }
        let wait = self
            .last_read
            .map(|last| (last + MIN_READ_GAP).saturating_duration_since(now))
            .unwrap_or_default();
        let read_at = now + wait;
        self.last_read = Some(read_at);
        if detail {
            self.detail_reads.push_back(read_at);
        }
        Ok(wait)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_read_goes_at_once_and_the_next_waits_out_the_gap() {
        let mut guard = LinkedInReadGuard::default();
        let start = Instant::now();
        assert_eq!(guard.admit(start, false), Ok(Duration::ZERO));
        assert_eq!(
            guard.admit(start + Duration::from_secs(1), true),
            Ok(Duration::from_secs(2))
        );
        assert_eq!(
            guard.admit(start + Duration::from_secs(10), true),
            Ok(Duration::ZERO)
        );
    }

    #[test]
    fn back_to_back_reads_are_spaced_from_the_scheduled_time_not_the_request() {
        let mut guard = LinkedInReadGuard::default();
        let start = Instant::now();
        guard.admit(start, false).unwrap();
        assert_eq!(guard.admit(start, true), Ok(MIN_READ_GAP));
        assert_eq!(guard.admit(start, true), Ok(MIN_READ_GAP * 2));
    }

    #[test]
    fn details_pages_stop_at_the_budget_but_the_main_profile_still_reads() {
        let mut guard = LinkedInReadGuard::default();
        let start = Instant::now();
        for step in 0..MAX_DETAIL_READS {
            let at = start + MIN_READ_GAP * (step as u32 + 1);
            assert!(guard.admit(at, true).is_ok());
        }
        let later = start + Duration::from_secs(3_600);
        assert_eq!(
            guard.admit(later, true),
            Err("linkedin_detail_budget_exhausted")
        );
        assert!(guard.admit(later, false).is_ok());
    }

    #[test]
    fn the_budget_returns_after_the_window() {
        let mut guard = LinkedInReadGuard::default();
        let start = Instant::now();
        for step in 0..MAX_DETAIL_READS {
            guard
                .admit(start + MIN_READ_GAP * (step as u32 + 1), true)
                .unwrap();
        }
        let next_day = start + DETAIL_WINDOW + Duration::from_secs(60);
        assert!(guard.admit(next_day, true).is_ok());
    }

    #[test]
    fn detail_pages_are_recognised_by_path() {
        assert!(is_detail_page("/in/me/details/courses/"));
        assert!(is_detail_page("/in/jordan/overlay/contact-info/"));
        assert!(!is_detail_page("/in/me/"));
    }
}
