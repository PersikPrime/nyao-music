import Foundation
import AVFoundation
import MediaPlayer
import UIKit

/// Плеер: AVPlayer, фон, экран блокировки и Пункт управления, история и «сейчас играет» для друзей.
@MainActor
final class Player: ObservableObject {
    static let shared = Player()

    enum Mode: String { case list, wave, radio }

    @Published private(set) var queue: [Track] = []
    @Published private(set) var index = 0
    @Published private(set) var isPlaying = false
    @Published private(set) var loading = false
    @Published var position: Double = 0
    @Published private(set) var duration: Double = 0
    @Published private(set) var mode: Mode = .list
    @Published private(set) var label = ""
    @Published var error: String?

    private let player = AVPlayer()
    private let repo = Repo.shared
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var statusObserver: NSKeyValueObservation?
    private var startedAt = Date()
    private var loadToken = 0
    private var retried = Set<String>()
    private var fetchingMore = false
    private var artwork: (String, MPMediaItemArtwork)?
    private var counted: String?

    var current: Track? { queue.indices.contains(index) ? queue[index] : nil }

    private init() {
        player.automaticallyWaitsToMinimizeStalling = true
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] t in
            MainActor.assumeIsolated { self?.tick(t.seconds) }
        }
        setupSession()
        setupRemote()
    }

    // MARK: аудиосессия и пульт

    private func setupSession() {
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playback, mode: .default, policy: .longFormAudio)
        NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] n in
            guard let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt, let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            MainActor.assumeIsolated {
                if type == .began { self?.isPlaying = false; self?.updateNowPlaying() }
                else if let o = n.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt, AVAudioSession.InterruptionOptions(rawValue: o).contains(.shouldResume) { self?.play() }
            }
        }
    }

    private func setupRemote() {
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { [weak self] _ in MainActor.assumeIsolated { self?.play() }; return .success }
        c.pauseCommand.addTarget { [weak self] _ in MainActor.assumeIsolated { self?.pause() }; return .success }
        c.togglePlayPauseCommand.addTarget { [weak self] _ in MainActor.assumeIsolated { self?.toggle() }; return .success }
        c.nextTrackCommand.addTarget { [weak self] _ in MainActor.assumeIsolated { self?.next() }; return .success }
        c.previousTrackCommand.addTarget { [weak self] _ in MainActor.assumeIsolated { self?.previous() }; return .success }
        c.changePlaybackPositionCommand.addTarget { [weak self] e in
            if let e = e as? MPChangePlaybackPositionCommandEvent { MainActor.assumeIsolated { self?.seek(e.positionTime) } }
            return .success
        }
        c.likeCommand.isEnabled = false
        c.dislikeCommand.isEnabled = false
    }

    // MARK: очередь

    func play(_ tracks: [Track], at i: Int = 0, mode: Mode = .list, label: String = "") {
        let list = tracks.filter(\.available)
        guard !list.isEmpty else { return }
        leave()
        let start = tracks.indices.contains(i) ? (list.firstIndex(of: tracks[i]) ?? 0) : 0
        queue = list
        index = start
        self.mode = mode
        self.label = label
        load()
    }

    func startWave() {
        guard repo.anyService else { repo.show("Сначала войди в Яндекс, VK или SoundCloud"); return }
        loading = true
        Task {
            let list = await repo.waveStart()
            loading = false
            if list.isEmpty { repo.show("Волна пока пустая — попробуй позже"); return }
            play(list, mode: .wave, label: "Моя волна")
        }
    }

    func startRadio(_ t: Track) {
        Task {
            let list = await repo.radio(from: t)
            play([t] + list.filter { $0.id != t.id }, mode: .radio, label: "Радио по треку")
        }
    }

    func playNext(_ t: Track) {
        if queue.isEmpty { play([t]); return }
        queue.removeAll { $0.id == t.id && $0.id != current?.id }
        queue.insert(t, at: min(index + 1, queue.count))
    }

    func jump(to i: Int) {
        guard queue.indices.contains(i) else { return }
        leave()
        index = i
        load()
    }

    func next() {
        guard !queue.isEmpty else { return }
        leave(skipped: true)
        if index + 1 < queue.count { index += 1; load() } else {
            Task { await more(); if index + 1 < queue.count { index += 1; load() } else { pause() } }
        }
    }

    func previous() {
        if position > 5 || index == 0 { seek(0); return }
        leave(skipped: true)
        index -= 1
        load()
    }

    func toggle() { isPlaying ? pause() : play() }

    func play() {
        guard current != nil else { return }
        if player.currentItem == nil { load(); return }
        player.play()
        isPlaying = true
        updateNowPlaying()
        sendNow(force: true)
    }

    func pause() {
        player.pause()
        isPlaying = false
        updateNowPlaying()
        sendNow(force: true)
    }

    func seek(_ sec: Double) {
        player.seek(to: CMTime(seconds: max(0, sec), preferredTimescale: 600))
        position = sec
        updateNowPlaying()
    }

    // MARK: загрузка трека

    private func load() {
        guard let t = current else { return }
        loadToken += 1
        let token = loadToken
        loading = true
        error = nil
        position = 0
        duration = Double(t.duration)
        startedAt = Date()
        counted = nil
        player.pause()
        player.replaceCurrentItem(with: nil)
        updateNowPlaying()
        Task {
            do {
                let url = try await repo.streamURL(t)
                guard token == loadToken else { return }
                try? AVAudioSession.sharedInstance().setActive(true)
                let item = AVPlayerItem(asset: AVURLAsset(url: url))
                observe(item, track: t, token: token)
                player.replaceCurrentItem(with: item)
                player.play()
                isPlaying = true
                loading = false
                updateNowPlaying()
                sendNow(force: true)
                if mode == .wave, t.source == Source.ya { await repo.ya.waveFeedback("trackStarted", track: t) }
                if index >= queue.count - 3 { await more() }
            } catch {
                guard token == loadToken else { return }
                loading = false
                fail(t, error)
            }
        }
    }

    private func observe(_ item: AVPlayerItem, track t: Track, token: Int) {
        statusObserver = item.observe(\.status) { [weak self] it, _ in
            guard it.status == .failed else { return }
            let err = it.error
            Task { @MainActor in
                guard let self, token == self.loadToken else { return }
                self.fail(t, err ?? ApiError("Трек не играет"))
            }
        }
        if let e = endObserver { NotificationCenter.default.removeObserver(e) }
        endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.leave(skipped: false, finished: true)
                if self.index + 1 < self.queue.count { self.index += 1; self.load() }
                else { Task { await self.more(); if self.index + 1 < self.queue.count { self.index += 1; self.load() } else { self.isPlaying = false } } }
            }
        }
    }

    /// Ссылка протухла — один раз пробуем новую, потом пропускаем трек
    private func fail(_ t: Track, _ e: Error) {
        repo.forgetStream(t)
        if !retried.contains(t.id) {
            retried.insert(t.id)
            load()
            return
        }
        error = e.localizedDescription
        repo.show("«\(t.title)»: \(e.localizedDescription)")
        if index + 1 < queue.count {
            index += 1
            load()
        } else {
            isPlaying = false
        }
    }

    private func more() async {
        guard !fetchingMore, mode != .list else { return }
        fetchingMore = true
        defer { fetchingMore = false }
        let add: [Track]
        switch mode {
        case .wave: add = await repo.waveMore(queue: queue)
        case .radio: add = await repo.radioMore(source: queue.first?.source ?? "", queue: queue)
        case .list: add = []
        }
        let have = Set(queue.map(\.id))
        queue += add.filter { !have.contains($0.id) && $0.available }
    }

    private func tick(_ sec: Double) {
        guard sec.isFinite else { return }
        position = sec
        if let d = player.currentItem?.duration.seconds, d.isFinite, d > 0 { duration = d }
        // 30 секунд — трек засчитан (для пасхалки «сотый трек»)
        if sec >= 30, let t = current, counted != t.id {
            counted = t.id
            Hundred.countPlay()
        }
        sendNow()
    }

    /// Трек сменился: в историю (и на сервер Nyao, если вошёл) и отзыв в волну
    private func leave(skipped: Bool = false, finished: Bool = false) {
        guard let t = current, player.currentItem != nil else { return }
        let listened = Int(position)
        let dur = duration > 0 ? Int(duration) : t.duration
        let skip = !finished && listened < min(30, max(1, dur / 2))
        if listened < 5 && !skip { return }
        let cloud = repo.cloud.loggedIn
        Task {
            await History.shared.record(t, listened: listened, skipped: skip, cloud: cloud)
            if mode == .wave, t.source == Source.ya { await repo.ya.waveFeedback(skip ? "skip" : "trackFinished", track: t, played: listened) }
            if cloud { await repo.cloud.flush() }
        }
    }

    private func sendNow(force: Bool = false) {
        let t = current, pos = position, playing = isPlaying, ctx = mode.rawValue
        Task { await repo.cloud.setNow(t, position: pos, playing: playing, context: ctx, force: force) }
    }

    // MARK: экран блокировки

    private func updateNowPlaying() {
        guard let t = current else { MPNowPlayingInfoCenter.default().nowPlayingInfo = nil; return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: t.title,
            MPMediaItemPropertyArtist: t.artist,
            MPMediaItemPropertyAlbumTitle: t.album.isEmpty ? Source.name(t.source) : t.album,
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0,
        ]
        if let a = artwork, a.0 == t.id { info[MPMediaItemPropertyArtwork] = a.1 }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        if artwork?.0 != t.id { loadArtwork(t) }
    }

    private func loadArtwork(_ t: Track) {
        Task {
            var img: UIImage?
            if let s = t.cover, let u = URL(string: s), let res = try? await Net.session.data(from: u) { img = UIImage(data: res.0) }
            // без обложки — шаблонный диск, иначе система покажет картинку прошлого трека
            let image = img ?? TemplateCover.image(for: t.id, size: 600)
            guard current?.id == t.id else { return }
            artwork = (t.id, MPMediaItemArtwork(boundsSize: image.size) { _ in image })
            updateNowPlaying()
        }
    }
}
