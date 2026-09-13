const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Refinery job persistence
  getJobs: () => ipcRenderer.invoke('store:getJobs'),
  setJobs: (jobs) => ipcRenderer.invoke('store:setJobs', jobs),

  // UEX Corp commodity data
  getCommodities: () => ipcRenderer.invoke('api:getCommodities'),
  getCommodityPrices: (id, type) => ipcRenderer.invoke('api:getCommodityPrices', { id, type }),

  // Window controls
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  setOpacity: (v) => ipcRenderer.invoke('window:setOpacity', v),
  setAlwaysOnTop: (v) => ipcRenderer.invoke('window:setAlwaysOnTop', v),

  // Desktop notifications
  notify: (title, body) => ipcRenderer.invoke('notify', { title, body }),

  // Toggle shortcut
  getShortcut: () => ipcRenderer.invoke('shortcut:get'),
  setShortcut: (acc) => ipcRenderer.invoke('shortcut:set', acc),

  // Generic store
  getStore: (key, def) => ipcRenderer.invoke('store:get', key, def),
  setStore: (key, val) => ipcRenderer.invoke('store:set', key, val),

  // Game log watcher
  getLogPath: () => ipcRenderer.invoke('log:getPath'),
  setLogPath: (p) => ipcRenderer.invoke('log:setPath', p),
  getLogStatus: () => ipcRenderer.invoke('log:getStatus'),
  onRefineryKioskDetected: (cb) => ipcRenderer.on('log:refineryKioskDetected', cb),
  onRefineryJobComplete: (cb) => ipcRenderer.on('log:refineryJobComplete', cb),
});
