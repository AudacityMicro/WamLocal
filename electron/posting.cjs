const path = require("node:path");
const { access } = require("node:fs/promises");
function registerPosting({ ipcMain, dialog, win, postJob, writePostedFiles }) {
  let pending = false;
  ipcMain.handle("wam:post", async (event, job, sheetId) => {
    if (
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame
    )
      throw Error("Post request rejected");
    if (pending) throw Error("Another post is in progress");
    pending = true;
    try {
      const files = postJob(job, sheetId);
      let directory,
        replace = false;
      if (sheetId) {
        const selected = await dialog.showSaveDialog(win, {
          title: "Post sheet",
          defaultPath: files[0].filename,
          filters: [{ name: "WAZER cut file", extensions: ["gcode"] }],
        });
        if (selected.canceled || !selected.filePath) return null;
        directory = path.dirname(selected.filePath);
        files[0].filename = path.basename(selected.filePath);
        replace = true;
      } else {
        const selected = await dialog.showOpenDialog(win, {
          title: "Post all sheets — choose output folder",
          properties: ["openDirectory", "createDirectory"],
        });
        if (selected.canceled || !selected.filePaths.length) return null;
        directory = selected.filePaths[0];
        const existing = [];
        for (const f of files)
          if (
            await access(path.join(directory, f.filename)).then(
              () => true,
              () => false,
            )
          )
            existing.push(f.filename);
        if (existing.length) {
          const answer = await dialog.showMessageBox(win, {
            type: "question",
            title: "Replace cut files?",
            message: `Replace ${existing.length} existing cut file(s)?`,
            detail: existing.join("\n"),
            buttons: ["Replace", "Cancel"],
            defaultId: 1,
            cancelId: 1,
          });
          if (answer.response !== 0) return null;
          replace = true;
        }
      }
      const paths = await writePostedFiles(directory, files, replace);
      return { paths, sheets: files.map(({ content, ...f }) => f) };
    } finally {
      pending = false;
    }
  });
}
module.exports = { registerPosting };
