// Настройки (обычный JSON) и секреты (токен Яндекса, cookies Google),
// зашифрованные через safeStorage — на Windows это DPAPI текущего пользователя.
import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_SETTINGS = {
  volume: 0.8,
  ytmShare: 30,          // доля треков YouTube Music в «Моей волне», %
  waveDiversity: 'favorite', // favorite | discover | popular
  waveMood: null,        // null | active | fun | calm | sad
  autoplay: true,
  quality: 'high',
  sourcePref: 'auto',
  discordRpc: true,      // статус в Discord включён сразу — приложение nyao.Music встроено
  onboarded: false
};

function dataPath(name) {
  return path.join(app.getPath('userData'), name);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

export const settings = {
  get() {
    const saved = readJson(dataPath('settings.json'), {});
    // 0.4: раньше статус Discord был выключен, пока не впишешь свой Application ID. Теперь ID встроен —
    // включаем один раз всем, дальше уважаем выбор пользователя.
    if (!saved.rpcBuiltin) {
      saved.discordRpc = true;
      saved.rpcBuiltin = true;
      delete saved.discordClientId;
      writeJson(dataPath('settings.json'), saved);
    }
    return { ...DEFAULT_SETTINGS, ...saved };
  },
  set(patch) {
    const next = { ...this.get(), ...patch };
    writeJson(dataPath('settings.json'), next);
    return next;
  }
};

const SECRETS_FILE = 'secrets.bin';

function readSecrets() {
  const file = dataPath(SECRETS_FILE);
  if (!fs.existsSync(file)) return {};
  try {
    const buf = fs.readFileSync(file);
    const text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function writeSecrets(obj) {
  const text = JSON.stringify(obj);
  const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text, 'utf8');
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(dataPath(SECRETS_FILE), buf);
}

export const secrets = {
  get(key) {
    return readSecrets()[key];
  },
  set(key, value) {
    const all = readSecrets();
    if (value === undefined || value === null) delete all[key];
    else all[key] = value;
    writeSecrets(all);
  }
};
