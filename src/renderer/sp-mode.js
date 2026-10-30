// Spotify сам играть не может (нет Premium, не запустился плеер, не вошли) — треки Spotify
// играют найденной копией из другого сервиса (значок «SP → Я»). Выставляют app.js и spotify-sync.js.
export const spMode = {
  fallback: true,
  native: false,
  subs: new Map() // id трека Spotify → копия, которая играет вместо него
};
