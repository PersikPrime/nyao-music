// GitHub для Automator: релизы, запуск сборок (workflow_dispatch), заметки к релизу, артефакты с логами,
// последний релиз приватного репозитория Automator. Токен (GH_ADMIN_TOKEN) живёт только здесь, на сервере.
import { unzip } from './zip.js';

const API = 'https://api.github.com';
export const WORKFLOWS = { desktop: 'desktop.yml', android: 'android.yml', server: 'server.yml', ops: 'ops.yml' };

export class GitHub {
  constructor({ token = '', repo = 'PersikPrime/nyao-music', automatorRepo = 'PersikPrime/automator', fetch = globalThis.fetch, log = console.log } = {}) {
    this.token = token;
    this.repo = repo;
    this.automatorRepo = automatorRepo;
    this.fetch = fetch;
    this.log = log;
  }

  get configured() {
    return !!this.token;
  }

  headers(extra = {}) {
    return { Accept: 'application/vnd.github+json', 'User-Agent': 'NyaoAutomator-Server', 'X-GitHub-Api-Version': '2022-11-28', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...extra };
  }

  async api(method, path, body, { raw = false, repo = this.repo } = {}) {
    const res = await this.fetch(path.startsWith('http') ? path : `${API}/repos/${repo}${path}`, {
      method,
      headers: this.headers(body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'follow'
    });
    if (raw) return res;
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const e = new Error(`GitHub ${res.status}: ${(json && json.message) || text.slice(0, 200)}`);
      e.status = res.status;
      throw e;
    }
    return json;
  }

  /** Релизы приложения, по каналам: stable (обычные), dev, nightly */
  async releases(limit = 30) {
    const list = await this.api('GET', `/releases?per_page=${limit}`);
    return (Array.isArray(list) ? list : []).filter((r) => !r.draft).map((r) => ({
      id: r.id,
      tag: r.tag_name,
      name: r.name,
      channel: /-dev$/.test(r.tag_name) ? 'dev' : /-nightly$/.test(r.tag_name) ? 'nightly' : 'stable',
      build: Number(/\.(\d+)(?:-[a-z]+)?$/.exec(r.tag_name || '')?.[1] || 0),
      prerelease: !!r.prerelease,
      publishedAt: r.published_at,
      url: r.html_url,
      body: r.body || '',
      assets: (r.assets || []).map((a) => ({ id: a.id, name: a.name, size: a.size, downloads: a.download_count, url: a.browser_download_url }))
    }));
  }

  /** Запустить workflow (сборка, деплой, операции на сервере) */
  async dispatch(workflow, ref, inputs = {}) {
    const file = WORKFLOWS[workflow];
    if (!file) throw new Error(`Нет такого workflow: ${workflow}`);
    await this.api('POST', `/actions/workflows/${file}/dispatches`, { ref, inputs });
    return { ok: true, workflow: file, ref };
  }

  /** Последние запуски workflows */
  async runs({ workflow = null, limit = 30 } = {}) {
    const path = workflow && WORKFLOWS[workflow] ? `/actions/workflows/${WORKFLOWS[workflow]}/runs?per_page=${limit}` : `/actions/runs?per_page=${limit}`;
    const j = await this.api('GET', path);
    return (j.workflow_runs || []).map(runInfo);
  }

  async run(id) {
    const r = await this.api('GET', `/actions/runs/${Number(id)}`);
    const arts = await this.api('GET', `/actions/runs/${Number(id)}/artifacts`).catch(() => ({ artifacts: [] }));
    return { ...runInfo(r), artifacts: (arts.artifacts || []).map((a) => ({ id: a.id, name: a.name, size: a.size_in_bytes, expired: a.expired })) };
  }

  /** Скачать артефакт и вернуть текстовые файлы из него */
  async artifactFiles(artifactId) {
    const res = await this.api('GET', `/actions/artifacts/${Number(artifactId)}/zip`, null, { raw: true });
    if (!res.ok) throw new Error(`GitHub ${res.status}: артефакт не скачался`);
    const buf = Buffer.from(await res.arrayBuffer());
    return unzip(buf).map((f) => ({ name: f.name, text: f.data.toString('utf8').slice(0, 2_000_000) }));
  }

  /** Заметки к релизу: файл .github/notes/v<версия>[-канал].md в ветке (создать или обновить) */
  async putNotes({ version, channel = '', text, branch = null, author = '' }) {
    const tag = `v${version}${channel ? `-${channel}` : ''}`;
    const path = `.github/notes/${tag}.md`;
    const ref = branch || (channel === 'dev' ? 'dev' : channel === 'nightly' ? 'nightly' : 'main');
    let sha;
    try {
      const cur = await this.api('GET', `/contents/${path}?ref=${encodeURIComponent(ref)}`);
      sha = cur && cur.sha;
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    const j = await this.api('PUT', `/contents/${path}`, {
      message: `Заметки к релизу ${tag}${author ? ` (${author}, Automator)` : ''}`,
      content: Buffer.from(String(text), 'utf8').toString('base64'),
      branch: ref,
      ...(sha ? { sha } : {})
    });
    return { ok: true, path, branch: ref, commit: j && j.commit && j.commit.sha, updated: !!sha };
  }

  async getNotes({ version, channel = '', branch = null }) {
    const tag = `v${version}${channel ? `-${channel}` : ''}`;
    const ref = branch || (channel === 'dev' ? 'dev' : channel === 'nightly' ? 'nightly' : 'main');
    try {
      const cur = await this.api('GET', `/contents/.github/notes/${tag}.md?ref=${encodeURIComponent(ref)}`);
      return { text: Buffer.from(cur.content || '', 'base64').toString('utf8'), sha: cur.sha, branch: ref };
    } catch (e) {
      if (e.status === 404) return { text: '', sha: null, branch: ref };
      throw e;
    }
  }

  /** Последний релиз Automator (приватный репозиторий — нужен токен) */
  async automatorLatest() {
    const r = await this.api('GET', '/releases/latest', null, { repo: this.automatorRepo });
    return {
      tag: r.tag_name,
      name: r.name,
      publishedAt: r.published_at,
      body: r.body || '',
      assets: (r.assets || []).map((a) => ({ id: a.id, name: a.name, size: a.size }))
    };
  }

  /** Поток файла релиза Automator (через API, с токеном) */
  async automatorAsset(name) {
    const rel = await this.api('GET', '/releases/latest', null, { repo: this.automatorRepo });
    const a = (rel.assets || []).find((x) => x.name === name);
    if (!a) return null;
    const res = await this.fetch(a.url, { headers: this.headers({ Accept: 'application/octet-stream' }), redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`GitHub ${res.status}: файл не скачался`);
    return { body: res.body, size: a.size, name: a.name };
  }
}

function runInfo(r) {
  return {
    id: r.id,
    workflow: r.name,
    path: r.path,
    status: r.status,
    conclusion: r.conclusion,
    branch: r.head_branch,
    sha: r.head_sha,
    event: r.event,
    actor: r.actor && r.actor.login,
    startedAt: r.run_started_at,
    updatedAt: r.updated_at,
    durationSec: r.run_started_at && r.updated_at ? Math.round((new Date(r.updated_at) - new Date(r.run_started_at)) / 1000) : null,
    url: r.html_url
  };
}
