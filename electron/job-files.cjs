const path = require("node:path");
function registerJobFiles({
  ipcMain,
  dialog,
  win,
  readJobFile,
  writeJobFile,
  jobFilename,
}) {
  let currentPath = null;
  const documentPaths = new Map();
  let dirty = false;
  let allowClose = false;
  let pending = Promise.resolve();
  const check = (event) => {
    if (
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame
    )
      throw Error("Job file request rejected");
  };
  const serial = (fn) => {
    const work = pending.then(fn);
    pending = work.catch(() => {});
    return work;
  };
  ipcMain.handle("wam:job-open", (event, documentId) => {
    check(event);
    return serial(async () => {
      const result = await dialog.showOpenDialog(win, {
        title: "Open job",
        properties: ["openFile"],
        filters: [{ name: "WAM jobs", extensions: ["wam", "json"] }],
      });
      if (result.canceled || !result.filePaths.length) return null;
      const file = result.filePaths[0];
      const job = await readJobFile(file);
      if (typeof documentId === "string") documentPaths.set(documentId, file);
      else currentPath = file;
      return { job, path: file };
    });
  });
  ipcMain.handle("wam:job-save", (event, value, saveAs, documentId) => {
    check(event);
    return serial(async () => {
      const tabbed = typeof documentId === "string";
      let file = tabbed ? documentPaths.get(documentId) : currentPath;
      if (saveAs || !file) {
        const name = jobFilename(String(value?.name || "Untitled job"));
        const result = await dialog.showSaveDialog(win, {
          title: "Save job",
          defaultPath: file || name,
          filters: [{ name: "WAM job", extensions: ["wam"] }],
        });
        if (result.canceled || !result.filePath) return null;
        file = result.filePath;
        if (!path.extname(file)) file += ".wam";
      }
      const normalized = path.join(
        path.dirname(file),
        jobFilename(path.basename(file)),
      );
      if (normalized !== path.normalize(file)) {
        // A changed name must pass through the native overwrite prompt again.
        const result = await dialog.showSaveDialog(win, {
          title: "Save job",
          defaultPath: normalized,
          filters: [{ name: "WAM job", extensions: ["wam"] }],
        });
        if (result.canceled || !result.filePath) return null;
        const selected = path.join(
          path.dirname(result.filePath),
          jobFilename(path.basename(result.filePath)),
        );
        if (selected !== path.normalize(result.filePath))
          throw Error(
            "Choose a filename with underscores instead of periods (except .wam).",
          );
        file = selected;
      }
      await writeJobFile(file, value);
      if (tabbed) documentPaths.set(documentId, file);
      else currentPath = file;
      return { path: file };
    });
  });
  ipcMain.handle("wam:job-discard-prompt", async (event, name) => {
    check(event);
    const result = await dialog.showMessageBox(win, {
      type: "question",
      title: "Unsaved job",
      message:
        typeof name === "string"
          ? `Save changes to ${name}?`
          : "Save changes to this job?",
      buttons: ["Save", "Don't save", "Cancel"],
      defaultId: 0,
      cancelId: 2,
    });
    return ["save", "discard", "cancel"][result.response];
  });
  ipcMain.handle("wam:job-reset", (event, documentId) => {
    check(event);
    if (typeof documentId === "string") documentPaths.delete(documentId);
    else currentPath = null;
  });
  ipcMain.on("wam:job-dirty", (event, value) => {
    check(event);
    dirty = value === true;
  });
  ipcMain.on("wam:job-close", (event) => {
    check(event);
    allowClose = true;
    win.close();
  });
  win.on("close", (event) => {
    if (dirty && !allowClose) {
      event.preventDefault();
      win.webContents.send("wam:file-command", "close");
    }
  });
  return (command) => win.webContents.send("wam:file-command", command);
}
module.exports = { registerJobFiles };
