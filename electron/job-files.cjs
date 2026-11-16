const path = require("node:path");
function registerJobFiles({ ipcMain, dialog, win, readJobFile, writeJobFile }) {
  let currentPath = null;
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
  ipcMain.handle("wam:job-open", (event) => {
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
      currentPath = file;
      dirty = false;
      return { job, path: file };
    });
  });
  ipcMain.handle("wam:job-save", (event, value, saveAs) => {
    check(event);
    return serial(async () => {
      let file = currentPath;
      if (saveAs || !file) {
        const name = String(value?.name || "Untitled job").replace(
          /[<>:"/\\|?*\x00-\x1f]/g,
          "_",
        );
        const result = await dialog.showSaveDialog(win, {
          title: "Save job",
          defaultPath: currentPath || `${name}.wam`,
          filters: [{ name: "WAM job", extensions: ["wam"] }],
        });
        if (result.canceled || !result.filePath) return null;
        file = result.filePath;
        if (!path.extname(file)) file += ".wam";
      }
      await writeJobFile(file, value);
      currentPath = file;
      dirty = false;
      return { path: file };
    });
  });
  ipcMain.handle("wam:job-discard-prompt", async (event) => {
    check(event);
    const result = await dialog.showMessageBox(win, {
      type: "question",
      title: "Unsaved job",
      message: "Save changes to this job?",
      buttons: ["Save", "Don't save", "Cancel"],
      defaultId: 0,
      cancelId: 2,
    });
    return ["save", "discard", "cancel"][result.response];
  });
  ipcMain.handle("wam:job-reset", (event) => {
    check(event);
    currentPath = null;
    dirty = false;
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
