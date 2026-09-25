//! Reading pace for the candidate's own LinkedIn session, enforced in Rust
//! (B266 security WARN: the limits lived only in the web layer, so any script
//! in the app could drive the session as fast as it liked).
//!
//! Every read waits until `MIN_READ_GAP` has passed since the previous one.
//! Per rolling `DETAIL_WINDOW`, all reads are capped at `MAX_READS` and every
//! page other than a profile root at `MAX_DETAIL_READS`. The state lives in
//! the process, like the session window, so an app restart resets it.

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const MIN_READ_GAP: Duration = Duration::from_secs(3);
/// Seven details pages plus the contact-info overlay (linkedinSessionPoll.ts).
pub const MAX_DETAIL_READS: usize = 8;
pub const DETAIL_WINDOW: Duration = Duration::from_secs(12 * 60 * 60);
/// Two full walks (profile + 8) with room for a retry; other people's
/// profiles are profile roots too, so they must hit a ceiling as well.
pub const MAX_READS: usize = 16;

#[derive(Debug, Default)]
pub struct LinkedInReadGuard {
    last_read: Option<Instant>,
    detail_reads: VecDeque<Instant>,
    all_reads: VecDeque<Instant>,
}

#[derive(Debug, Default)]
pub struct LinkedInReadGuardState(pub Mutex<LinkedInReadGuard>);

/// Everything except a profile root (`/in/<slug>/`) counts as a detail page:
/// sections, the contact overlay, search. The path is lowercased and
/// percent-decoded first, so `/D%65tails/` cannot pass as a profile.
pub fn is_detail_page(path: &str) -> bool {
    let normalised = percent_decode(path).to_lowercase();
    let segments: Vec<&str> = normalised
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    !matches!(segments.as_slice(), ["in", slug] if !slug.starts_with('.'))
}

fn percent_decode(path: &str) -> String {
    let bytes = path.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let hex = bytes
            .get(index + 1..index + 3)
            .and_then(|pair| std::str::from_utf8(pair).ok())
            .and_then(|pair| u8::from_str_radix(pair, 16).ok());
        match (bytes[index], hex) {
            (b'%', Some(byte)) => {
                decoded.push(byte);
                index += 3;
            }
            (byte, _) => {
                decoded.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

fn expire(reads: &mut VecDeque<Instant>, now: Instant) {
    while reads
        .front()
        .is_some_and(|read| now.saturating_duration_since(*read) >= DETAIL_WINDOW)
    {
        reads.pop_front();
    }
}

impl LinkedInReadGuard {
    /// Admits one read at `now` and returns how long to wait before it, or
    /// refuses a details page once the window's budget is spent.
    pub fn admit(&mut self, now: Instant, detail: bool) -> Result<Duration, &'static str> {
        expire(&mut self.detail_reads, now);
        expire(&mut self.all_reads, now);
        if self.all_reads.len() >= MAX_READS {
            return Err("linkedin_read_budget_exhausted");
        }
        if detail && self.detail_reads.len() >= MAX_DETAIL_READS {
            return Err("linkedin_detail_budget_exhausted");
        }
        let wait = self.pace(now);
        let read_at = now + wait;
        self.all_reads.push_back(read_at);
        if detail {
            self.detail_reads.push_back(read_at);
        }
        Ok(wait)
    }

    /// Spaces a navigation that returns no page (the sign-in window opening
    /// on a LinkedIn URL) without spending the read budget: refusing it would
    /// leave the candidate unable even to sign in.
    pub fn pace(&mut self, now: Instant) -> Duration {
        let wait = self
            .last_read
            .map(|last| (last + MIN_READ_GAP).saturating_duration_since(now))
            .unwrap_or_default();
        self.last_read = Some(now + wait);
        wait
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
    fn every_read_counts_toward_a_total_cap_even_profile_pages() {
        let mut guard = LinkedInReadGuard::default();
        let start = Instant::now();
        for step in 0..MAX_READS {
            let at = start + MIN_READ_GAP * (step as u32 + 1);
            assert!(guard.admit(at, false).is_ok());
        }
        let later = start + Duration::from_secs(3_600);
        assert_eq!(
            guard.admit(later, false),
            Err("linkedin_read_budget_exhausted")
        );
    }

    #[test]
    fn pacing_an_opened_window_waits_but_spends_no_budget() {
        let mut guard = LinkedInReadGuard::default();
        let start = Instant::now();
        guard.admit(start, false).unwrap();
        assert_eq!(guard.pace(start), MIN_READ_GAP);
        for step in 0..MAX_DETAIL_READS {
            let at = start + Duration::from_secs(60) + MIN_READ_GAP * (step as u32 + 1);
            assert!(guard.admit(at, true).is_ok());
        }
    }

    #[test]
    fn anything_but_a_profile_root_is_a_detail_page_after_normalising() {
        assert!(!is_detail_page("/in/me/"));
        assert!(!is_detail_page("/in/Jordan-Rivers"));
        assert!(is_detail_page("/in/me/d%65tails/courses/"));
        assert!(is_detail_page("/in/me/DETAILS/skills/"));
        assert!(is_detail_page("/search/results/people/"));
        assert!(is_detail_page("/in/me/%2e%2e/"));
    }

    #[test]
    fn detail_pages_are_recognised_by_path() {
        assert!(is_detail_page("/in/me/details/courses/"));
        assert!(is_detail_page("/in/jordan/overlay/contact-info/"));
        assert!(!is_detail_page("/in/me/"));
    }
}
