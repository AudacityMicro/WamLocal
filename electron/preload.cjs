const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "jobFiles",
  Object.freeze({
    open: () => ipcRenderer.invoke("wam:job-open"),
    post: (job, sheetId) => ipcRenderer.invoke("wam:post", job, sheetId),
    save: (job, saveAs = false) =>
      ipcRenderer.invoke("wam:job-save", job, saveAs),
    reset: () => ipcRenderer.invoke("wam:job-reset"),
    confirmDiscard: () => ipcRenderer.invoke("wam:job-discard-prompt"),
    updateViewPreferences: (value) =>
      ipcRenderer.send("wam:view-preferences", value),
    setDirty: (value) => ipcRenderer.send("wam:job-dirty", value),
    close: () => ipcRenderer.send("wam:job-close"),
    onCommand: (callback) => {
      const listener = (_event, command) => callback(command);
      ipcRenderer.on("wam:file-command", listener);
      return () => ipcRenderer.removeListener("wam:file-command", listener);
    },
  }),
);
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
