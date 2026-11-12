import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from '@agripos/shared';
const bridge: DesktopBridge = {
  uploadShopLogo: () => ipcRenderer.invoke('shop:logo'),
  printTest: (options) => ipcRenderer.invoke('printer:test', options),
  uploadProductImage: (productId) => ipcRenderer.invoke('product:image', productId),
  printReport: (options) => ipcRenderer.invoke('printer:report', options),
  offlineStatus: () => ipcRenderer.invoke('offline:status'),
  prepareOffline: (pin) => ipcRenderer.invoke('offline:prepare', pin),
  unlockOffline: (pin) => ipcRenderer.invoke('offline:unlock', pin),
  syncNow: () => ipcRenderer.invoke('offline:sync'),
  pendingSales: () => ipcRenderer.invoke('checkout:pending'),
  info: async () => ({
    ...(await ipcRenderer.invoke('app:info')),
    contextIsolated: process.contextIsolated,
    sandboxed: process.sandboxed,
  }),
  configure: (input) => ipcRenderer.invoke('connection:configure', input),
  login: (input) => ipcRenderer.invoke('auth:login', input),
  logout: () => ipcRenderer.invoke('auth:logout'),
  changePassword: (input) => ipcRenderer.invoke('auth:password', input),
  request: (input) => ipcRenderer.invoke('api:request', input),
  printers: () => ipcRenderer.invoke('printer:list'),
  printReceipt: (options) => ipcRenderer.invoke('printer:receipt', options),
};
contextBridge.exposeInMainWorld('desktop', Object.freeze(bridge));
