import SwiftUI
import AVKit

/// «Сейчас играет»: обложка, перемотка, кнопки, текст песни и очередь.
/// compact — колонка справа на iPad
struct NowPlayingView: View {
    var compact = false
    @EnvironmentObject var player: Player
    @EnvironmentObject var repo: Repo
    @State private var pane: Pane = .cover
    @State private var scrubbing: Double?
    @State private var lyrics: Lyrics?
    @State private var lyricsFor: String?
    @State private var heartPop = false

    enum Pane { case cover, lyrics, queue }

    var body: some View {
        if let t = player.current {
            ZStack {
                background(t)
                VStack(spacing: 0) {
                    if !compact { header }
                    Group {
                        switch pane {
                        case .cover: coverPane(t)
                        case .lyrics: LyricsPane(lyrics: lyrics, position: player.position) { player.seek($0) }
                        case .queue: QueuePane()
                        }
                    }
                    .frame(maxHeight: .infinity)
                    meta(t)
                    progress
                    controls
                    tools
                }
                .padding(.horizontal, compact ? 18 : 26)
                .padding(.bottom, compact ? 14 : 24)
            }
            .task(id: t.id) { await loadLyrics(t) }
        } else {
            VStack(spacing: 12) {
                Image(systemName: "waveform").font(.system(size: 40)).foregroundStyle(Nyao.accent)
                Text("Ничего не играет").foregroundStyle(Nyao.muted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity).background(Nyao.bg)
        }
    }

    private func background(_ t: Track) -> some View {
        ZStack {
            Color.black
            CoverView(url: t.cover, key: t.id, radius: 0).blur(radius: 60).opacity(0.55).scaleEffect(1.4)
            LinearGradient(colors: [.clear, .black.opacity(0.75)], startPoint: .top, endPoint: .bottom)
        }
        .ignoresSafeArea()
    }

    private var header: some View {
        VStack(spacing: 2) {
            Text(player.mode == .wave ? "ИЗ ВОЛНЫ" : player.mode == .radio ? "РАДИО" : "ИГРАЕТ").font(.system(size: 11, weight: .semibold)).tracking(1).foregroundStyle(.white.opacity(0.7))
            Text(player.label.isEmpty ? "Nyao Music" : player.label).font(.system(size: 13, weight: .semibold))
        }
        .padding(.top, 22).padding(.bottom, 8)
    }

    private func coverPane(_ t: Track) -> some View {
        CoverView(url: t.cover, key: t.id, radius: 28)
            .aspectRatio(1, contentMode: .fit)
            // двойной тап по обложке — лайк, с сердцем по центру
            .overlay {
                Image(systemName: "heart.fill").font(.system(size: 90)).foregroundStyle(.white.opacity(0.92))
                    .scaleEffect(heartPop ? 1.15 : 0.4).opacity(heartPop ? 1 : 0)
                    .allowsHitTesting(false)
            }
            .onTapGesture(count: 2) {
                if !repo.likedIds.contains(t.id) { Task { await repo.toggleLike(t) } }
                withAnimation(.spring(duration: 0.25)) { heartPop = true }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { withAnimation(.easeOut(duration: 0.3)) { heartPop = false } }
            }
            .shadow(color: .black.opacity(0.5), radius: 30, y: 16)
            .padding(.vertical, 16)
            .scaleEffect(player.isPlaying ? 1 : 0.92)
            .animation(.spring(duration: 0.4), value: player.isPlaying)
    }

    private func meta(_ t: Track) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(t.title).font(Nyao.title(compact ? 19 : 22)).lineLimit(2)
                HStack(spacing: 6) { SourceBadge(source: t.source); Text(t.artist).font(.system(size: 15)).foregroundStyle(.white.opacity(0.75)).lineLimit(1) }
            }
            Spacer()
            Button { Task { await repo.toggleLike(t) } } label: {
                Image(systemName: repo.likedIds.contains(t.id) ? "heart.fill" : "heart").font(.system(size: 20)).foregroundStyle(Color(hex: "#FF8FB1")).frame(width: 44, height: 44)
            }
            .glass(22)
        }
        .padding(.top, 12)
    }

    private var progress: some View {
        let dur = max(player.duration, 1)
        return VStack(spacing: 6) {
            Slider(value: Binding(get: { scrubbing ?? player.position }, set: { scrubbing = $0 }), in: 0...dur) { editing in
                if !editing, let s = scrubbing { player.seek(s); scrubbing = nil }
            }
            .tint(.white)
            HStack {
                Text(formatTime(scrubbing ?? player.position))
                Spacer()
                Text("−" + formatTime(max(0, dur - (scrubbing ?? player.position))))
            }
            .font(.system(size: 12).monospacedDigit()).foregroundStyle(.white.opacity(0.7))
        }
        .padding(.top, 14)
    }

    private var controls: some View {
        HStack(spacing: compact ? 34 : 44) {
            Button { player.previous() } label: { Image(systemName: "backward.fill").font(.system(size: compact ? 28 : 34)) }
            Button { player.toggle() } label: {
                ZStack {
                    Circle().fill(Nyao.text).frame(width: compact ? 64 : 80, height: compact ? 64 : 80)
                    if player.loading { ProgressView().tint(.black) } else {
                        Image(systemName: player.isPlaying ? "pause.fill" : "play.fill").font(.system(size: compact ? 26 : 32)).foregroundStyle(.black)
                    }
                }
            }
            Button { player.next() } label: { Image(systemName: "forward.fill").font(.system(size: compact ? 28 : 34)) }
        }
        .foregroundStyle(.white)
        .padding(.top, 8)
    }

    private var tools: some View {
        HStack {
            toolButton("quote.bubble", .lyrics)
            Spacer()
            AirPlayButton().frame(width: 44, height: 44)
            Spacer()
            sleepButton
            Spacer()
            toolButton("list.bullet", .queue)
        }
        .padding(.horizontal, 30).padding(.top, 18)
    }

    /// Таймер сна: меню с минутами и «после этого трека»
    private var sleepButton: some View {
        Menu {
            if !player.sleepLabel.isEmpty {
                Text("Пауза \(player.sleepLabel)")
                Button("Выключить таймер", role: .destructive) { player.stopSleep() }
            }
            ForEach([15, 30, 45, 60, 90], id: \.self) { m in Button("Через \(m) мин") { player.startSleep(minutes: m) } }
            Button("После этого трека") { player.startSleep(minutes: 0) }
        } label: {
            Image(systemName: player.sleepLabel.isEmpty ? "moon" : "moon.fill").font(.system(size: 20))
                .foregroundStyle(player.sleepLabel.isEmpty ? .white.opacity(0.85) : Nyao.accent).frame(width: 44, height: 44)
        }
        .accessibilityLabel(player.sleepLabel.isEmpty ? "Таймер сна" : "Таймер сна: \(player.sleepLabel)")
    }

    private func toolButton(_ icon: String, _ p: Pane) -> some View {
        Button { withAnimation(.spring(duration: 0.3)) { pane = pane == p ? .cover : p } } label: {
            Image(systemName: icon).font(.system(size: 20)).foregroundStyle(pane == p ? Nyao.accent : .white.opacity(0.85)).frame(width: 44, height: 44)
        }
    }

    private func loadLyrics(_ t: Track) async {
        guard lyricsFor != t.id else { return }
        lyricsFor = t.id
        lyrics = nil
        lyrics = await LyricsAPI.shared.find(t, ya: repo.ya)
    }
}

struct AirPlayButton: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let v = AVRoutePickerView()
        v.tintColor = .white
        v.activeTintColor = UIColor(Nyao.accent)
        return v
    }
    func updateUIView(_ uiView: AVRoutePickerView, context: Context) {}
}

struct LyricsPane: View {
    let lyrics: Lyrics?
    let position: Double
    let seek: (Double) -> Void

    private var active: Int? {
        guard let l = lyrics, l.synced else { return nil }
        return l.lines.lastIndex { ($0.time ?? 0) <= position + 0.25 }
    }

    var body: some View {
        if let l = lyrics {
            ScrollViewReader { proxy in
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 16) {
                        ForEach(Array(l.lines.enumerated()), id: \.offset) { i, line in
                            Text(line.text.isEmpty ? "♪" : line.text)
                                .font(.system(size: 26, weight: .bold))
                                .foregroundStyle(!l.synced ? .white : i == active ? .white : .white.opacity(i < (active ?? -1) ? 0.3 : 0.4))
                                .id(i)
                                .onTapGesture { if let t = line.time { seek(t) } }
                        }
                        Text(l.source).font(.system(size: 12)).foregroundStyle(.white.opacity(0.5)).padding(.top, 20)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 40)
                }
                .onChange(of: active) { _, a in if let a { withAnimation(.easeInOut(duration: 0.35)) { proxy.scrollTo(a, anchor: .center) } } }
            }
        } else {
            VStack { Spacer(); Text("Текста нет или ещё ищем…").foregroundStyle(.white.opacity(0.6)); Spacer() }.frame(maxWidth: .infinity)
        }
    }
}

struct QueuePane: View {
    @EnvironmentObject var player: Player
    var body: some View {
        ScrollViewReader { proxy in
            List {
                ForEach(Array(player.queue.enumerated()), id: \.element.id) { i, t in
                    Button { player.jump(to: i) } label: { TrackRow(track: t, active: i == player.index) }
                        .buttonStyle(.plain)
                        .listRowBackground(Color.clear)
                        .id(i)
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .onAppear { proxy.scrollTo(player.index, anchor: .top) }
        }
    }
}
