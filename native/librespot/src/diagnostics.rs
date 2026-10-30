//! Observe only known failure stages. Never retain/emit upstream log text, URLs or credentials.
use std::{collections::VecDeque, fmt::{self, Write}, sync::Mutex};
use log::{Log, Metadata, Record, LevelFilter};

pub struct SafeDiagnostics(Mutex<VecDeque<&'static str>>);
pub static DIAGNOSTICS: SafeDiagnostics = SafeDiagnostics(Mutex::new(VecDeque::new()));

fn classify(target: &str, message: &str) -> Option<&'static str> {
    if target == "librespot_core::audio_key" && message.starts_with("error audio key ") {
        return Some("audio_key_rejected");
    }
    if target != "librespot_playback::player" { return None; }
    if message.starts_with("Unable to load key,") { return Some("audio_key_failed"); }
    if message.starts_with("Unable to load audio item:") {
        return Some(if message.contains("PermissionDenied") || message.contains("Permission denied") ||
            message.contains("Unauthenticated") || message.contains("No valid authentication credentials") {
            "metadata_denied"
        } else { "metadata_failed" });
    }
    if message.starts_with("Track is unavailable:") { return Some("availability_restricted"); }
    if message.starts_with("Track should be available, but no alternatives found.") ||
        message.ends_with("is not available in any supported format") {
        return Some("format_missing");
    }
    if message.starts_with("Unable to load encrypted file:") { return Some("stream_failed"); }
    if message.starts_with("Unable to read audio file:") { return Some("decoder_failed"); }
    None
}

// Format just enough to identify a known message; even the temporary text is bounded.
struct Prefix(String);
impl Write for Prefix {
    fn write_str(&mut self, text: &str) -> fmt::Result {
        let mut end = text.len().min(2048_usize.saturating_sub(self.0.len()));
        while !text.is_char_boundary(end) { end -= 1; }
        self.0.push_str(&text[..end]); Ok(())
    }
}
impl Log for SafeDiagnostics {
    fn enabled(&self, metadata: &Metadata) -> bool {
        metadata.level() <= log::Level::Warn &&
            matches!(metadata.target(), "librespot_playback::player" | "librespot_core::audio_key")
    }
    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) { return; }
        let mut prefix = Prefix(String::new());
        let _ = write!(prefix, "{}", record.args());
        if let Some(code) = classify(record.target(), &prefix.0) {
            if let Ok(mut codes) = self.0.lock() {
                if codes.back().copied() != Some(code) { codes.push_back(code); }
                while codes.len() > 8 { codes.pop_front(); }
            }
        }
    }
    fn flush(&self) {}
}
impl SafeDiagnostics {
    pub fn install(&'static self) {
        if log::set_logger(self).is_ok() { log::set_max_level(LevelFilter::Warn); }
    }
    pub fn clear(&self) { if let Ok(mut codes) = self.0.lock() { codes.clear(); } }
    pub fn codes(&self) -> Vec<&'static str> {
        self.0.lock().map(|codes| codes.iter().copied().collect()).unwrap_or_default()
    }
    pub fn failure(&self) -> &'static str {
        let codes = self.codes();
        // Decoder errors are a consequence when the library was refused an audio key.
        for code in ["audio_key_rejected", "audio_key_failed", "metadata_denied", "metadata_failed",
            "availability_restricted", "format_missing", "stream_failed", "decoder_failed"] {
            if codes.contains(&code) { return code; }
        }
        "load_failed"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_static_codes_leave_the_classifier() {
        let secret = "Bearer PRIVATE_TOKEN https://cdn.example/track?token=PRIVATE_COOKIE";
        assert_eq!(classify("librespot_playback::player", &format!("Unable to load audio item: PermissionDenied {secret}")), Some("metadata_denied"));
        assert_eq!(classify("librespot_core::audio_key", "error audio key 0 1"), Some("audio_key_rejected"));
        assert_eq!(classify("librespot_playback::player", secret), None);
        assert_eq!(classify("librespot_core::login5", &format!("Got auth token: {secret}")), None);
    }
    #[test]
    fn refusal_is_preserved_when_decoder_failure_follows() {
        let d = SafeDiagnostics(Mutex::new(VecDeque::from(["audio_key_rejected", "audio_key_failed", "decoder_failed"])));
        assert_eq!(d.failure(), "audio_key_rejected");
        assert_eq!(d.codes(), vec!["audio_key_rejected", "audio_key_failed", "decoder_failed"]);
        d.clear(); assert_eq!(d.failure(), "load_failed");
    }
    #[test]
    fn formatting_is_bounded_and_keeps_unicode_valid() {
        let mut p = Prefix(String::new()); let _ = write!(p, "{}", "я".repeat(5000));
        assert!(p.0.len() <= 2048); assert_eq!(p.0.chars().count(), 1024);
    }
}
