import SwiftUI

// MARK: - Главная

struct HomeView: View {
    @EnvironmentObject var repo: Repo
    @EnvironmentObject var player: Player
    @Environment(\.horizontalSizeClass) private var hsize

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                WaveHero()
                if repo.recent.isEmpty && repo.libraryLoading {
                    HomeSection(title: "Продолжить слушать") { ShelfSkeleton() }
                } else if !repo.recent.isEmpty {
                    HomeSection(title: "Продолжить слушать") {
                        ScrollView(.horizontal, showsIndicators: false) {
                            LazyHStack(alignment: .top, spacing: 12) {
                                ForEach(Array(repo.recent.enumerated()), id: \.element.id) { i, t in
                                    Button { player.play(repo.recent, at: i, label: "Недавнее") } label: { TrackTile(track: t) }.buttonStyle(.plain)
                                }
                            }
                            .padding(.horizontal, 16)
                        }
                    }
                }
                HomeSection(title: "Миксы") {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: 10)], spacing: 10) {
                        MixTile(title: "Мне нравится", key: "liked") { player.play(repo.liked.shuffled(), label: "Мне нравится") }
                        ForEach(Source.all.filter { repo.loggedIn($0) }, id: \.self) { s in
                            MixTile(title: "Только \(Source.name(s))", key: s) { player.play(repo.liked.filter { $0.source == s }.shuffled(), label: Source.name(s)) }
                        }
                    }
                    .padding(.horizontal, 16)
                }
                if repo.playlists.isEmpty && repo.libraryLoading && repo.anyService {
                    HomeSection(title: "Плейлисты") { ShelfSkeleton() }
                } else if !repo.playlists.isEmpty {
                    HomeSection(title: "Плейлисты") {
                        ScrollView(.horizontal, showsIndicators: false) {
                            LazyHStack(alignment: .top, spacing: 12) {
                                ForEach(repo.playlists.prefix(20)) { p in
                                    NavigationLink(value: Route.playlist(p)) { PlaylistTile(playlist: p) }.buttonStyle(.plain)
                                }
                            }
                            .padding(.horizontal, 16)
                        }
                    }
                }
                Spacer(minLength: 90)
            }
            .padding(.top, 8)
        }
        .refreshable { await repo.loadLibrary() }
        .navigationTitle(greeting)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if hsize != .regular { NavigationLink(value: Route.settings) { Image(systemName: "gearshape") } }
            }
        }
    }

    private var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        switch h { case 5..<12: return "Доброе утро"; case 12..<18: return "Добрый день"; case 18..<23: return "Добрый вечер"; default: return "Доброй ночи" }
    }
}

struct HomeSection<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.system(size: 19, weight: .bold)).padding(.horizontal, 20)
            content
        }
    }
}

struct WaveHero: View {
    @EnvironmentObject var player: Player
    @EnvironmentObject var repo: Repo

    var body: some View {
        Button { player.startWave() } label: {
            ZStack(alignment: .bottomLeading) {
                RadialGradient(colors: [Color(hex: "#3B2E7A"), Color(hex: "#17142A"), Color(hex: "#0B0A12")], center: .init(x: 0.2, y: 0.1), startRadius: 0, endRadius: 420)
                WaveLines().stroke(Nyao.accent, lineWidth: 3).frame(height: 110).offset(y: -40).opacity(0.9)
                VStack(alignment: .leading, spacing: 6) {
                    Text("МОЯ ВОЛНА · " + Source.all.filter { repo.loggedIn($0) }.map { $0 == Source.ya ? "Я" : $0.uppercased() }.joined(separator: " + "))
                        .font(.system(size: 12, weight: .semibold)).tracking(1).foregroundStyle(Nyao.accent)
                    Spacer()
                    HStack(alignment: .bottom) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Под настроение").font(Nyao.title(26)).foregroundStyle(.white)
                            Text(player.mode == .wave ? "Играет сейчас" : "Знакомое и новое вперемешку").font(.system(size: 13)).foregroundStyle(Color(hex: "#C9C9CE"))
                        }
                        Spacer()
                        ZStack {
                            Circle().fill(Nyao.text).frame(width: 58, height: 58)
                            if player.loading && player.mode != .wave { ProgressView().tint(.black) } else {
                                Image(systemName: "play.fill").font(.system(size: 22)).foregroundStyle(.black)
                            }
                        }
                    }
                }
                .padding(20)
            }
            .frame(height: 208)
            .clipShape(RoundedRectangle(cornerRadius: 32, style: .continuous))
            .padding(.horizontal, 16)
        }
        .buttonStyle(.plain)
    }
}

struct WaveLines: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        for i in 0...Int(r.width) {
            let x = Double(i)
            let y = r.midY + sin(x / r.width * .pi * 4) * r.height * 0.32
            i == 0 ? p.move(to: CGPoint(x: x, y: y)) : p.addLine(to: CGPoint(x: x, y: y))
        }
        return p
    }
}

struct TrackTile: View {
    let track: Track
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            CoverView(url: track.cover, key: track.id, radius: 22).frame(width: 132, height: 132)
            Text(track.title).font(.system(size: 13, weight: .semibold)).lineLimit(1).foregroundStyle(Nyao.text)
            HStack(spacing: 5) { SourceBadge(source: track.source); Text(track.artist).font(.system(size: 12)).foregroundStyle(Nyao.muted).lineLimit(1) }
        }
        .frame(width: 132)
    }
}

struct PlaylistTile: View {
    let playlist: Playlist
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            CoverView(url: playlist.cover, key: playlist.id, radius: 22).frame(width: 132, height: 132)
            Text(playlist.title).font(.system(size: 13, weight: .semibold)).lineLimit(1).foregroundStyle(Nyao.text)
            HStack(spacing: 5) { SourceBadge(source: playlist.source); Text(playlist.count > 0 ? "\(playlist.count) \(plural(playlist.count, "трек", "трека", "треков"))" : Source.name(playlist.source)).font(.system(size: 12)).foregroundStyle(Nyao.muted).lineLimit(1) }
        }
        .frame(width: 132)
    }
}

struct MixTile: View {
    let title: String
    let key: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                TemplateCoverView(key: key).frame(width: 44, height: 44).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                Text(title).font(.system(size: 14, weight: .semibold)).lineLimit(2).foregroundStyle(Nyao.text)
                Spacer(minLength: 0)
            }
            .padding(10).frame(height: 64)
            .background(Nyao.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(Nyao.line))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Волна

struct WaveView: View {
    @EnvironmentObject var repo: Repo
    @EnvironmentObject var player: Player
    @State private var mood = Prefs.shared.waveMood ?? "any"
    @State private var diversity = Prefs.shared.waveDiversity
    @State private var sources = Set(Prefs.shared.waveSources)

    var body: some View {
        List {
            Section { WaveHero().listRowInsets(EdgeInsets()).listRowBackground(Color.clear) }
            Section("Настроение") {
                Picker("Настроение", selection: $mood) {
                    Text("Любое").tag("any"); Text("Бодрое").tag("active"); Text("Весёлое").tag("fun"); Text("Спокойное").tag("calm"); Text("Грустное").tag("sad")
                }
                .pickerStyle(.segmented)
                Picker("Подбор", selection: $diversity) {
                    Text("Обычный").tag("default"); Text("Любимое").tag("favorite"); Text("Незнакомое").tag("discover"); Text("Популярное").tag("popular")
                }
            }
            Section("Сервисы в волне") {
                ForEach(Source.all, id: \.self) { s in
                    Toggle(isOn: Binding(get: { sources.contains(s) }, set: { on in if on { sources.insert(s) } else { sources.remove(s) } })) {
                        HStack { SourceBadge(source: s); Text(Source.name(s)) }
                    }
                    .disabled(!repo.loggedIn(s))
                }
            }
            if player.mode == .wave, !player.queue.isEmpty {
                Section("Дальше в волне") {
                    ForEach(Array(player.queue.enumerated()).dropFirst(player.index), id: \.element.id) { i, t in
                        Button { player.jump(to: i) } label: { TrackRow(track: t, active: i == player.index) }.buttonStyle(.plain)
                    }
                }
            }
        }
        .navigationTitle("Моя волна")
        .onChange(of: mood) { _, v in repo.prefs.waveMood = v == "any" ? nil : v }
        .onChange(of: diversity) { _, v in repo.prefs.waveDiversity = v }
        .onChange(of: sources) { _, v in repo.prefs.waveSources = Array(v) }
    }
}

// MARK: - Медиатека

struct LibraryView: View {
    @EnvironmentObject var repo: Repo
    @EnvironmentObject var player: Player

    var body: some View {
        List {
            Section {
                NavigationLink(value: Route.liked) {
                    HStack(spacing: 12) {
                        RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color(hex: "#2A0E18")).frame(width: 48, height: 48)
                            .overlay(Image(systemName: "heart.fill").foregroundStyle(Color(hex: "#FF8FB1")))
                        VStack(alignment: .leading) {
                            Text("Мне нравится").font(.system(size: 16, weight: .semibold))
                            Text("\(repo.liked.count) \(plural(repo.liked.count, "трек", "трека", "треков"))").font(.system(size: 13)).foregroundStyle(Nyao.muted)
                        }
                    }
                }
            }
            ForEach(Source.all.filter { s in repo.playlists.contains { $0.source == s } }, id: \.self) { s in
                Section(Source.name(s)) {
                    ForEach(repo.playlists.filter { $0.source == s }) { p in
                        NavigationLink(value: Route.playlist(p)) {
                            HStack(spacing: 12) {
                                CoverView(url: p.cover, key: p.id, radius: 10).frame(width: 48, height: 48)
                                VStack(alignment: .leading) {
                                    Text(p.title).font(.system(size: 15, weight: .semibold)).lineLimit(1)
                                    if p.count > 0 { Text("\(p.count) \(plural(p.count, "трек", "трека", "треков"))").font(.system(size: 13)).foregroundStyle(Nyao.muted) }
                                }
                            }
                        }
                    }
                }
            }
            if repo.libraryLoading { RowsSkeleton(count: repo.playlists.isEmpty ? 6 : 2).listRowSeparator(.hidden) }
        }
        .navigationTitle("Медиатека")
        .refreshable { await repo.loadLibrary() }
    }
}

struct TrackList: View {
    let tracks: [Track]
    let label: String
    @EnvironmentObject var player: Player
    @EnvironmentObject var repo: Repo

    var body: some View {
        ForEach(Array(tracks.enumerated()), id: \.element.id) { i, t in
            Button { player.play(tracks, at: i, label: label) } label: { TrackRow(track: t, active: player.current?.id == t.id) }
                .buttonStyle(.plain)
                .contextMenu { TrackMenu(track: t) }
        }
    }
}

struct TrackMenu: View {
    let track: Track
    @EnvironmentObject var player: Player
    @EnvironmentObject var repo: Repo
    var body: some View {
        Button { player.playNext(track) } label: { Label("Играть следующим", systemImage: "text.insert") }
        Button { player.startRadio(track) } label: { Label("Радио по треку", systemImage: "dot.radiowaves.left.and.right") }
        Button { Task { await repo.toggleLike(track) } } label: {
            repo.likedIds.contains(track.id) ? Label("Убрать из «Мне нравится»", systemImage: "heart.slash") : Label("Мне нравится", systemImage: "heart")
        }
    }
}

struct LikedView: View {
    @EnvironmentObject var repo: Repo
    @EnvironmentObject var player: Player
    @State private var filter = "all"
    @State private var query = ""

    var tracks: [Track] {
        repo.liked.filter { (filter == "all" || $0.source == filter) && (query.isEmpty || $0.title.localizedCaseInsensitiveContains(query) || $0.artist.localizedCaseInsensitiveContains(query)) }
    }

    var body: some View {
        List {
            Picker("Сервис", selection: $filter) {
                Text("Все").tag("all")
                ForEach(Source.all.filter { repo.loggedIn($0) }, id: \.self) { Text(Source.name($0)).tag($0) }
            }
            .pickerStyle(.segmented)
            HStack {
                Button { player.play(tracks, label: "Мне нравится") } label: { Label("Слушать", systemImage: "play.fill") }.buttonStyle(.borderedProminent).foregroundStyle(Nyao.ink)
                Button { player.play(tracks.shuffled(), label: "Мне нравится") } label: { Label("Вперемешку", systemImage: "shuffle") }.buttonStyle(.bordered)
            }
            TrackList(tracks: tracks, label: "Мне нравится")
        }
        .listStyle(.plain)
        .searchable(text: $query, prompt: "Найти в «Мне нравится»")
        .navigationTitle("Мне нравится")
    }
}

struct PlaylistView: View {
    let playlist: Playlist
    @EnvironmentObject var repo: Repo
    @EnvironmentObject var player: Player
    @State private var tracks: [Track] = []
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        List {
            HStack(spacing: 16) {
                CoverView(url: playlist.cover, key: playlist.id, radius: 18).frame(width: 110, height: 110)
                VStack(alignment: .leading, spacing: 6) {
                    Text(playlist.title).font(Nyao.title(20)).lineLimit(3)
                    HStack(spacing: 6) { SourceBadge(source: playlist.source); Text("\(tracks.count) \(plural(tracks.count, "трек", "трека", "треков"))").foregroundStyle(Nyao.muted).font(.system(size: 13)) }
                    Button { player.play(tracks, label: playlist.title) } label: { Label("Слушать", systemImage: "play.fill") }
                        .buttonStyle(.borderedProminent).foregroundStyle(Nyao.ink).disabled(tracks.isEmpty)
                }
            }
            .listRowSeparator(.hidden)
            if loading { RowsSkeleton(count: 8).listRowSeparator(.hidden) }
            if let error { Text(error).foregroundStyle(Nyao.muted) }
            TrackList(tracks: tracks, label: playlist.title)
        }
        .listStyle(.plain)
        .navigationTitle(playlist.title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            do { tracks = try await repo.playlistTracks(playlist) } catch { self.error = error.localizedDescription }
            loading = false
        }
    }
}

// MARK: - Поиск

struct SearchView: View {
    @EnvironmentObject var repo: Repo
    @State private var query = ""
    @State private var results: [String: [Track]] = [:]
    @State private var loading = false
    @State private var task: Task<Void, Never>?

    var body: some View {
        List {
            if loading { HStack { Spacer(); ProgressView(); Spacer() } }
            ForEach([Source.ya, Source.vk, Source.sc], id: \.self) { s in
                if let list = results[s], !list.isEmpty {
                    Section(Source.name(s)) { TrackList(tracks: Array(list.prefix(20)), label: "Поиск") }
                }
            }
            if !loading && !query.isEmpty && results.values.allSatisfy(\.isEmpty) && !results.isEmpty {
                Text("Ничего не нашлось").foregroundStyle(Nyao.muted)
            }
        }
        .listStyle(.plain)
        .navigationTitle("Поиск")
        .searchable(text: $query, prompt: "Трек, исполнитель")
        .onSubmit(of: .search) { run() }
        .onChange(of: query) { _, _ in
            task?.cancel()
            task = Task { try? await Task.sleep(nanoseconds: 600_000_000); if !Task.isCancelled { run() } }
        }
    }

    private func run() {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else { results = [:]; return }
        loading = true
        Task {
            let r = await repo.search(q)
            if q == query.trimmingCharacters(in: .whitespaces) { results = r; loading = false }
        }
    }
}
