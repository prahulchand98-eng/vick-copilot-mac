const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  launchCopilot: (data) => ipcRenderer.send('launch-copilot', data),
  moveCopilot: (direction) => ipcRenderer.send('move-copilot', direction),
  closeCopilot: () => ipcRenderer.send('close-copilot'),
  minimizeCopilot: () => ipcRenderer.send('minimize-copilot'),
  resizeCopilot: (action) => ipcRenderer.send('resize-copilot', action),
  
  // API calls
  apiCallStream: (data) => ipcRenderer.invoke('api-call-stream', data),
  startSpeech: (data) => ipcRenderer.invoke('start-speech', data),
  stopSpeech: () => ipcRenderer.invoke('stop-speech'),
  
  // Screen capture (NEW)
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  analyzeScreens: (data) => ipcRenderer.invoke('analyze-screens', data),
  
  // Event listeners
  onCopilotData: (callback) => ipcRenderer.on('copilot-data', (event, data) => callback(data)),
  onStreamChunk: (callback) => ipcRenderer.on('stream-chunk', (event, text) => callback(text)),
  onStreamDone: (callback) => ipcRenderer.on('stream-done', () => callback()),
  onTranscript: (callback) => ipcRenderer.on('live-transcript', (event, data) => callback(data)),
  onAudioError: (callback) => ipcRenderer.on('audio-error', (event, type) => callback(type)),
  onProtocolLaunch: (callback) => ipcRenderer.on('protocol-launch', (event, data) => callback(data))
});