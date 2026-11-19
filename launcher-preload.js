'use strict';
// The only things the launcher bubble's page may do: report presses, and hear the ready-jobs count.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  down: () => ipcRenderer.send('launcher:down'),
  move: () => ipcRenderer.send('launcher:move'),
  up: () => ipcRenderer.send('launcher:up'),
  menu: () => ipcRenderer.send('launcher:menu'),
  onBadge: (cb) => ipcRenderer.on('launcher:badge', (_e, n) => cb(Number(n) || 0)),
});
