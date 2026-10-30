//! Local playback worker. Credentials arrive only over the private stdin pipe.
//! No discovery, external controller, password login, disk audio cache or token logging.
use std::{io::{self, Write}, sync::Arc, time::Duration};
use librespot::{
    core::{authentication::Credentials, config::SessionConfig, session::Session, SpotifyUri},
    playback::{audio_backend, config::{AudioFormat, Bitrate, PlayerConfig}, mixer::{self, Mixer, MixerConfig}, player::{Player, PlayerEvent}},
};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::{io::{AsyncBufReadExt, BufReader}, sync::mpsc};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Command {
    id: u64,
    command: String,
    access_token: Option<String>,
    device_id: Option<String>,
    uris: Option<Vec<String>>,
    position_ms: Option<u32>,
    volume: Option<f64>,
    generation: Option<u64>,
}

fn emit(value: Value) {
    let out = io::stdout();
    let mut lock = out.lock();
    let _ = writeln!(lock, "{}", value);
    let _ = lock.flush();
}

fn parse_tracks(uris: &[String]) -> Result<Vec<SpotifyUri>, &'static str> {
    if uris.is_empty() || uris.len() > 20 { return Err("invalid_queue"); }
    uris.iter().map(|uri| {
        let id = uri.strip_prefix("spotify:track:").ok_or("invalid_track")?;
        if id.len() != 22 || !id.bytes().all(|b| b.is_ascii_alphanumeric()) {
            return Err("invalid_track");
        }
        SpotifyUri::from_uri(uri).map_err(|_| "invalid_track")
    }).collect()
}

#[derive(Default)]
struct Worker {
    session: Option<Session>,
    player: Option<Arc<Player>>,
    mixer: Option<Arc<dyn Mixer>>,
    events: Option<mpsc::UnboundedReceiver<PlayerEvent>>,
    tracks: Vec<SpotifyUri>,
    index: usize,
    generation: u64,
    request: Option<u64>,
    waiting: bool,
    position: u32,
    duration: u32,
    paused: bool,
}

impl Worker {
    fn uri(&self) -> Option<String> { self.tracks.get(self.index).map(ToString::to_string) }
    fn snapshot(&self) {
        emit(json!({"event":"state","generation":self.generation,"snapshot":{
            "uri":self.uri(),"paused":self.paused,"position":self.position,"duration":self.duration
        }}));
    }
    fn reset(&mut self) {
        if let Some(p) = self.player.take() { p.stop(); }
        if let Some(s) = self.session.take() { s.shutdown(); }
        self.events = None;
        self.mixer = None;
        self.tracks.clear();
        self.request = None;
    }
    fn load_current(&mut self, position: u32) {
        if let (Some(player), Some(track)) = (&self.player, self.tracks.get(self.index)) {
            self.position = position;
            self.duration = 0;
            self.paused = true;
            self.waiting = true;
            self.request = None;
            player.load(track.clone(), true, position);
        }
    }
    async fn command(&mut self, cmd: &Command) -> Result<Value, &'static str> {
        match cmd.command.as_str() {
            "ping" => Ok(json!({"protocol":1,"engine":"librespot","version":"0.8.0"})),
            "connect" => {
                self.reset();
                let token = cmd.access_token.as_ref().filter(|t| !t.is_empty() && t.len() <= 8192).ok_or("auth")?;
                let backend = audio_backend::find(None).ok_or("audio_backend")?;
                let mut config = SessionConfig::default();
                if let Some(id) = &cmd.device_id {
                    if id.len() > 128 || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') { return Err("protocol"); }
                    config.device_id = id.clone();
                }
                let session = Session::new(config, None);
                match tokio::time::timeout(Duration::from_secs(25), session.connect(Credentials::with_access_token(token), false)).await {
                    Ok(Ok(())) => {},
                    _ => { session.shutdown(); return Err("auth"); }
                }
                let mixer = mixer::find(None).ok_or("audio_backend")?(MixerConfig::default()).map_err(|_| "audio_backend")?;
                // Start quietly; Nyao applies the user's saved volume before loading audio.
                mixer.set_volume(0);
                let config = PlayerConfig {
                    bitrate: Bitrate::Bitrate320,
                    position_update_interval: Some(Duration::from_millis(500)),
                    ..PlayerConfig::default()
                };
                let player = Player::new(config, session.clone(), mixer.get_soft_volume(), move || backend(None, AudioFormat::default()));
                self.events = Some(player.get_player_event_channel());
                self.player = Some(player);
                self.mixer = Some(mixer);
                let username = session.username();
                self.session = Some(session);
                self.paused = true;
                Ok(json!({"username":username}))
            },
            "play" => {
                if self.player.is_none() { return Err("not_ready"); }
                let tracks = parse_tracks(cmd.uris.as_ref().ok_or("invalid_queue")?)?;
                self.tracks = tracks;
                self.index = 0;
                self.generation = cmd.generation.ok_or("protocol")?;
                self.load_current(cmd.position_ms.unwrap_or(0));
                Ok(Value::Null)
            },
            "pause" => {
                if let Some(p) = &self.player { p.pause(); self.paused = true; self.snapshot(); }
                Ok(Value::Null)
            },
            "resume" => {
                self.player.as_ref().ok_or("not_ready")?.play();
                Ok(Value::Null)
            },
            "seek" => {
                self.player.as_ref().ok_or("not_ready")?.seek(cmd.position_ms.unwrap_or(0));
                Ok(Value::Null)
            },
            "next" => {
                if self.index + 1 >= self.tracks.len() { return Err("queue_end"); }
                self.index += 1;
                self.load_current(0);
                Ok(Value::Null)
            },
            "volume" => {
                let volume = cmd.volume.filter(|v| v.is_finite() && (0.0..=1.0).contains(v)).ok_or("protocol")?;
                self.mixer.as_ref().ok_or("not_ready")?.set_volume((volume * f64::from(u16::MAX)).round() as u16);
                Ok(Value::Null)
            },
            "stop" => { self.reset(); Ok(Value::Null) },
            _ => Err("protocol"),
        }
    }
    fn event(&mut self, event: PlayerEvent) {
        if let PlayerEvent::PlayRequestIdChanged { play_request_id } = event {
            self.request = Some(play_request_id);
            self.waiting = false;
            return;
        }
        if self.waiting { return; }
        let event_request = match &event {
            PlayerEvent::PositionChanged { play_request_id, .. } => Some(*play_request_id),
            _ => event.get_play_request_id(),
        };
        if let Some(id) = event_request {
            if self.request != Some(id) { return; }
        }
        let playing_event = matches!(&event, PlayerEvent::Playing { .. });
        match event {
            PlayerEvent::Playing { track_id, position_ms, .. } |
            PlayerEvent::PositionChanged { track_id, position_ms, .. } |
            PlayerEvent::PositionCorrection { track_id, position_ms, .. } |
            PlayerEvent::Seeked { track_id, position_ms, .. } => {
                if Some(track_id.to_string()) != self.uri() { return; }
                self.position = position_ms;
                if playing_event { self.paused = false; }
                self.snapshot();
            },
            PlayerEvent::Paused { track_id, position_ms, .. } => {
                if Some(track_id.to_string()) != self.uri() { return; }
                self.position = position_ms; self.paused = true; self.snapshot();
            },
            PlayerEvent::TrackChanged { audio_item } => {
                self.duration = audio_item.duration_ms;
            },
            PlayerEvent::TimeToPreloadNextTrack { .. } => {
                if let (Some(player), Some(next)) = (&self.player, self.tracks.get(self.index + 1)) { player.preload(next.clone()); }
            },
            PlayerEvent::EndOfTrack { track_id, .. } => {
                if Some(track_id.to_string()) != self.uri() { return; }
                if self.index + 1 < self.tracks.len() {
                    self.index += 1;
                    self.load_current(0);
                } else {
                    self.position = self.duration;
                    self.paused = true;
                    self.snapshot();
                    emit(json!({"event":"ended","generation":self.generation,"uri":self.uri()}));
                }
            },
            PlayerEvent::Unavailable { track_id, .. } => {
                if Some(track_id.to_string()) != self.uri() { return; }
                emit(json!({"event":"error","generation":self.generation,"kind":"playback","code":"unavailable"}));
            },
            _ => {},
        }
    }
}

#[tokio::main]
async fn main() {
    // All stdout is framed IPC. Do not install a logger or print received commands.
    emit(json!({"event":"hello","protocol":1}));
    let mut input = BufReader::new(tokio::io::stdin()).lines();
    let mut worker = Worker::default();
    loop {
        tokio::select! {
            line = input.next_line() => {
                let Ok(Some(line)) = line else { break; };
                if line.len() > 16384 { emit(json!({"event":"error","kind":"engine","code":"protocol"})); break; }
                match serde_json::from_str::<Command>(&line) {
                    Ok(cmd) => {
                        let result = worker.command(&cmd).await;
                        match result {
                            Ok(data) => emit(json!({"id":cmd.id,"ok":true,"data":data})),
                            Err(code) => emit(json!({"id":cmd.id,"ok":false,"code":code})),
                        }
                    },
                    Err(_) => { emit(json!({"event":"error","kind":"engine","code":"protocol"})); break; },
                }
            },
            event = async {
                match worker.events.as_mut() {
                    Some(events) => events.recv().await,
                    None => std::future::pending().await,
                }
            } => {
                if let Some(event) = event { worker.event(event); }
                else { worker.reset(); emit(json!({"event":"error","kind":"engine","code":"not_ready"})); }
            },
        }
    }
    worker.reset();
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_bounded_track_queues() {
        let good = "spotify:track:4uLU6hMCjMI75M1A2tKUQC".to_string();
        assert!(parse_tracks(&[good.clone()]).is_ok());
        assert!(parse_tracks(&vec![good; 21]).is_err());
        assert!(parse_tracks(&[]).is_err());
        assert!(parse_tracks(&["spotify:episode:4uLU6hMCjMI75M1A2tKUQC".into()]).is_err());
        assert!(parse_tracks(&["spotify:track:../../etc/passwd".into()]).is_err());
    }
    #[test]
    fn credentials_are_optional_for_non_auth_commands() {
        let ping: Command = serde_json::from_str(r#"{"id":1,"command":"ping"}"#).unwrap();
        assert!(ping.access_token.is_none());
        assert!(serde_json::from_str::<Command>(r#"{"command":"ping"}"#).is_err());
    }
    #[test]
    fn stale_positions_cannot_move_the_current_track() {
        let track = parse_tracks(&["spotify:track:4uLU6hMCjMI75M1A2tKUQC".into()]).unwrap().remove(0);
        let mut w = Worker { tracks: vec![track.clone()], request: Some(2), position: 123, ..Worker::default() };
        // Upstream get_play_request_id does not cover PositionChanged in 0.8.0.
        w.event(PlayerEvent::PositionChanged { play_request_id: 1, track_id: track.clone(), position_ms: 9999 });
        assert_eq!(w.position, 123);
        w.event(PlayerEvent::PositionChanged { play_request_id: 2, track_id: track, position_ms: 456 });
        assert_eq!(w.position, 456);
    }
}
