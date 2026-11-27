const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("camImport", {
  load: () => ipcRenderer.invoke("cam-import:load"),
  resolve: (reference) => ipcRenderer.invoke("cam-import:resolve", reference),
  finish: (result) => ipcRenderer.send("cam-import:finish", result),
});
