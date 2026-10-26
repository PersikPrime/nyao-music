// Мост для страницы Spotify Web Playback SDK в скрытом окне: те же методы, что AndroidBridge на телефоне.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('AndroidBridge', {
  onEvent: (type, payload) => ipcRenderer.send('sp:event', String(type), String(payload)),
  requestToken: (id) => ipcRenderer.send('sp:token', Number(id)),
  onCallResult: (id, ok, payload) => ipcRenderer.send('sp:result', Number(id), !!ok, String(payload))
});
