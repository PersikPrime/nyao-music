// Объединённые страницы исполнителя и альбома.
// Открываем страницу в одном сервисе, находим ту же сущность во втором и склеиваем:
// у каждого трека получается до двух «вариантов» — из Яндекса и из YouTube Music.

export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '') // (feat. …), [Remastered]
    .replace(/\s+-\s+(remaster|remastered|ost|single|version).*$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Склейка двух списков треков по названию (и длительности, если она есть у обоих)
export function matchTracks(primary, other, primarySource) {
  const otherSource = primarySource === 'ya' ? 'yt' : 'ya';
  const pool = [...(other || [])];
  const rows = primary.map((t) => {
    const key = norm(t.title);
    const idx = pool.findIndex((o) => norm(o.title) === key && (!t.duration || !o.duration || Math.abs(t.duration - o.duration) <= 6));
    const match = idx >= 0 ? pool.splice(idx, 1)[0] : null;
    return { title: t.title, artist: t.artist, duration: t.duration || (match && match.duration) || 0, cover: t.cover || (match && match.cover), [primarySource]: t, [otherSource]: match };
  });
  return { rows, rest: pool.map((o) => ({ title: o.title, artist: o.artist, duration: o.duration, cover: o.cover, [primarySource]: null, [otherSource]: o })) };
}

function dedupeBy(list, keyFn) {
  const seen = new Set();
  return list.filter((x) => {
    const k = keyFn(x);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export class Catalog {
  constructor({ ya, yt }) {
    this.p = { ya, yt };
  }

  available(source) {
    // Каталог YouTube Music читается и без входа, Яндекс — только с токеном
    return source === 'yt' || this.p.ya.loggedIn;
  }

  async findArtist(source, name) {
    if (!this.available(source)) return null;
    try {
      const list = await this.p[source].searchArtist(name);
      return list.find((a) => norm(a.name) === norm(name)) || null;
    } catch {
      return null;
    }
  }

  async artist(ref) {
    const [src, ...rest] = ref.split(':');
    const id = rest.join(':');
    const other = src === 'ya' ? 'yt' : 'ya';
    const main = await this.p[src].artist(id);
    let twin = null;
    const found = await this.findArtist(other, main.name);
    if (found) {
      try {
        twin = await this.p[other].artist(found.ref.slice(3));
      } catch {
        twin = null;
      }
    }
    const { rows, rest: extra } = matchTracks(main.popular, twin ? twin.popular : [], src);
    const albums = dedupeBy([...main.albums, ...(twin ? twin.albums : [])], (a) => `${a.kind}|${norm(a.title)}`);
    const similar = [];
    const s1 = main.similar, s2 = twin ? twin.similar : [];
    for (let i = 0; i < Math.max(s1.length, s2.length); i++) {
      if (s1[i]) similar.push(s1[i]);
      if (s2[i]) similar.push(s2[i]);
    }
    return {
      name: main.name,
      cover: main.cover || (twin && twin.cover),
      description: main.description || (twin && twin.description) || '',
      refs: { [src]: main.ref, [other]: twin ? twin.ref : null },
      listeners: { ya: src === 'ya' ? main.listeners : twin && twin.listeners, yt: null },
      popular: [...rows, ...extra].slice(0, 10),
      albums,
      similar: dedupeBy(similar, (a) => norm(a.name)).slice(0, 12)
    };
  }

  async album(ref) {
    const [src, ...rest] = ref.split(':');
    const id = rest.join(':');
    const other = src === 'ya' ? 'yt' : 'ya';
    const main = await this.p[src].album(id);
    let twin = null;
    if (this.available(other)) {
      try {
        const list = await this.p[other].searchAlbum(`${main.artist} ${main.title}`);
        const hit = list.find((a) => norm(a.title) === norm(main.title) && (!a.artist || norm(a.artist).includes(norm(main.artist).split(' ')[0])));
        if (hit) twin = await this.p[other].album(hit.ref.slice(3));
      } catch {
        twin = null;
      }
    }
    const { rows, rest: extra } = matchTracks(main.tracks, twin ? twin.tracks : [], src);
    return {
      title: main.title,
      artist: main.artist,
      artistRef: main.artistRef || (twin && twin.artistRef),
      year: main.year || (twin && twin.year),
      kind: main.kind,
      cover: main.cover || (twin && twin.cover),
      refs: { [src]: main.ref, [other]: twin ? twin.ref : null },
      tracks: [...rows, ...extra]
    };
  }
}
