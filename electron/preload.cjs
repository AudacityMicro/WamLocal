const { contextBridge, ipcRenderer, webUtils } = require("electron");
contextBridge.exposeInMainWorld(
  "importAssets",
  Object.freeze({
    resolve: (file, reference) =>
      ipcRenderer.invoke(
        "wam:import-asset",
        webUtils.getPathForFile(file),
        reference,
      ),
  }),
);
contextBridge.exposeInMainWorld(
  "jobFiles",
  Object.freeze({
    open: (documentId) => ipcRenderer.invoke("wam:job-open", documentId),
    post: (job, sheetId) => ipcRenderer.invoke("wam:post", job, sheetId),
    save: (job, saveAs = false, documentId) =>
      ipcRenderer.invoke("wam:job-save", job, saveAs, documentId),
    reset: (documentId) => ipcRenderer.invoke("wam:job-reset", documentId),
    confirmDiscard: (name) => ipcRenderer.invoke("wam:job-discard-prompt", name),
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

contextBridge.exposeInMainWorld(
  "mcpSetup",
  Object.freeze({
    load: () => ipcRenderer.invoke("wam:mcp-setup"),
    copy: (text) => ipcRenderer.invoke("wam:mcp-copy", text),
  }),
);
