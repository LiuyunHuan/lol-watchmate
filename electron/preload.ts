import { contextBridge, ipcRenderer } from 'electron';
import type { Bridge } from '../src/shared/types';
const bridge: Bridge = {
  snapshot: () => ipcRenderer.invoke('snapshot'),
  action: data => ipcRenderer.invoke('action', data),
  subscribe: listener => {
    const handler = (_: unknown, snapshot: Parameters<typeof listener>[0]) => listener(snapshot);
    ipcRenderer.on('state', handler);
    return () => ipcRenderer.removeListener('state', handler);
  },
  settings: data => ipcRenderer.invoke('settings', data),
  sources: () => ipcRenderer.invoke('sources'),
  selectSource: id => ipcRenderer.invoke('select-source', id),
  frame: frame => ipcRenderer.invoke('frame', frame),
  localProfile: profile => ipcRenderer.invoke('local-profile', profile),
  localReading: reading => ipcRenderer.invoke('local-reading', reading),
  broadcast: reading => ipcRenderer.invoke('broadcast', reading),
  questionFrame: frame => ipcRenderer.invoke('question-frame', frame),
  transcribe: audio => ipcRenderer.invoke('transcribe', audio),
  audio: data => ipcRenderer.invoke('audio', data),
  importMemes: () => ipcRenderer.invoke('import-memes'),
  openData: () => ipcRenderer.invoke('open-data'),
  exportDiagnostics: () => ipcRenderer.invoke('export-diagnostics'),
  openUrl: url => ipcRenderer.invoke('open-url', url),
  voices: () => ipcRenderer.invoke('voices'),
};
contextBridge.exposeInMainWorld('watchmate', bridge);
