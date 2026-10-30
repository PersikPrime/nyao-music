// Keep build IDs monotonic for old updaters, .nui rollback and Android.
// Public patch names can stay within one release: build 98 displays as 0.8.97.1.
export function publicVersion(v) {
  return /^\d+\.\d+\.\d+(?:\.\d+)?$/.test(v.displayVersion || '')
    ? v.displayVersion : v.name + '.' + v.build;
}
export function versionLabel(v) {
  const name = v.displayVersion ? publicVersion(v) : v.name + ' (' + v.build + ')';
  return name + (v.channel ? ' ' + v.channel : '');
}
