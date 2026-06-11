'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (callback) =>
  ipcRenderer.on(channel, (_event, data) => callback(data));

contextBridge.exposeInMainWorld('overlay', {
  ready: () => ipcRenderer.send('renderer-ready'),
  setPin: (pinned) => ipcRenderer.send('pin-state', !!pinned),
  manualSelect: () => ipcRenderer.send('manual-select'),
  selectionChanged: (id) => ipcRenderer.send('selection-changed', id),
  onAutoSelect: on('auto-select'),
  onSpotCaptured: on('spot-captured'),
  onInit: on('init'),
  onContext: on('context'),
  onGsiStatus: on('gsi-status'),
  onCommand: on('command'),
  onMouseMode: on('mouse-mode')
});
