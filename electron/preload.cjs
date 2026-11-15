const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('goldenPalaceDesktop', {
  isDesktop: true,
  getPrinters: () => ipcRenderer.invoke('desktop:get-printers'),
  printSilent: (options) => ipcRenderer.invoke('desktop:print-silent', options || {}),
  getDesktopInfo: () => ipcRenderer.invoke('desktop:get-info'),
});
