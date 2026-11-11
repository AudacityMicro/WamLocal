const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "materialDatabase",
  Object.freeze({
    load: () => ipcRenderer.invoke("wam:materials-load"),
    save: (value) => ipcRenderer.invoke("wam:materials-save", value),
  }),
);
contextBridge.exposeInMainWorld(
  "partClipboard",
  Object.freeze({
    copy: (text) => ipcRenderer.invoke("wam:copy-part", text),
    paste: () => ipcRenderer.send("wam:paste-parts"),
  }),
);
