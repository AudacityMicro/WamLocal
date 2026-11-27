if (process.argv.includes("--wam-cam-import")) {
  require("./mcp-import.cjs");
} else {
  const {
    app,
    BrowserWindow,
    session,
    Menu,
    dialog,
    ipcMain,
    clipboard,
  } = require("electron");
  const { registerPartClipboard } = require("./clipboard.cjs");
  const { autoUpdater } = require("electron-updater");
  const { createUpdateAction } = require("./updates.cjs");
  const path = require("node:path");
  if (process.env.WAM_USER_DATA_DIR)
    app.setPath("userData", path.resolve(process.env.WAM_USER_DATA_DIR));
  app.whenReady().then(() => {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
      callback({
        cancel:
          !details.url.startsWith("file:") &&
          !details.url.startsWith("devtools:") &&
          !details.url.startsWith("blob:") &&
          !details.url.startsWith("data:"),
      }),
    );
    const win = new BrowserWindow({
      width: 1540,
      height: 980,
      minWidth: 1100,
      minHeight: 720,
      backgroundColor: "#111518",
      autoHideMenuBar: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    registerPartClipboard({ ipcMain, clipboard, win });
    require("./import-assets.cjs").registerImportAssets({ ipcMain, win });
    const {
      readLibraryFile,
      writeLibraryFile,
      readJobFile,
      writeJobFile,
      postJob,
      writePostedFiles,
      jobFilename,
      cutFilename,
    } = require("../dist-electron/library.cjs");
    require("./posting.cjs").registerPosting({
      ipcMain,
      dialog,
      win,
      postJob,
      writePostedFiles,
      cutFilename,
    });
    const fileCommand = require("./job-files.cjs").registerJobFiles({
      ipcMain,
      dialog,
      win,
      readJobFile,
      writeJobFile,
      jobFilename,
    });
    const materialFile =
      process.env.WAM_MATERIAL_LIBRARY ||
      path.join(app.getPath("userData"), "material-library.json");
    const checkLibrarySender = (event) => {
      if (
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame
      )
        throw Error("Material database request rejected");
    };
    ipcMain.handle("wam:mcp-setup", (event) => {
      checkLibrarySender(event);
      return {
        command: process.execPath,
        args: [path.join(app.getAppPath(), "dist-mcp", "server.mjs")],
        projectDirectory: path.join(app.getPath("documents"), "Wam Local Jobs"),
        materialLibrary: materialFile,
        electron: true,
        portable: !!process.env.PORTABLE_EXECUTABLE_FILE,
      };
    });
    ipcMain.handle("wam:mcp-copy", (event, text) => {
      checkLibrarySender(event);
      if (typeof text !== "string" || text.length > 1_000_000)
        throw Error("Invalid MCP clipboard text");
      clipboard.writeText(text);
    });
    ipcMain.handle("wam:materials-load", (event) => {
      checkLibrarySender(event);
      return readLibraryFile(materialFile);
    });
    ipcMain.handle("wam:materials-save", (event, value) => {
      checkLibrarySender(event);
      return writeLibraryFile(materialFile, value);
    });
    ipcMain.on("wam:view-preferences", (event, value) => {
      checkLibrarySender(event);
      if (
        !value ||
        !["mm", "in"].includes(value.units) ||
        typeof value.showFileLabels !== "boolean"
      )
        return;
      const menu = Menu.getApplicationMenu();
      for (const unit of ["mm", "in"]) {
        const item = menu?.getMenuItemById(`units-${unit}`);
        if (item) item.checked = value.units === unit;
      }
      const labels = menu?.getMenuItemById("file-labels");
      if (labels) labels.checked = value.showFileLabels;
      for (const [id, flag] of [
        ["post-sheet", value.canPostSheet],
        ["post-all", value.canPostAll],
      ]) {
        const item = menu?.getMenuItemById(id);
        if (item && typeof flag === "boolean") item.enabled = flag;
      }
    });
    const checkForUpdates = createUpdateAction({
      app,
      dialog,
      updater: autoUpdater,
      getWindow: () => win,
      setMenuState: (enabled, label) => {
        const item =
          Menu.getApplicationMenu()?.getMenuItemById("github-update");
        if (item) {
          item.enabled = enabled;
          item.label = label;
        }
        if (!win.isDestroyed())
          win.setProgressBar(label.startsWith("Downloading") ? 2 : -1);
      },
    });
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "File",
          submenu: [
            {
              label: "New Job",
              accelerator: "CmdOrCtrl+N",
              click: () => fileCommand("new"),
            },
            {
              label: "Open Job…",
              accelerator: "CmdOrCtrl+O",
              click: () => fileCommand("open"),
            },
            { type: "separator" },
            {
              label: "Save",
              accelerator: "CmdOrCtrl+S",
              click: () => fileCommand("save"),
            },
            {
              label: "Save As…",
              accelerator: "CmdOrCtrl+Shift+S",
              click: () => fileCommand("save-as"),
            },
            { type: "separator" },
            { label: "Export SVG…", click: () => fileCommand("export-svg") },
            {
              id: "post-sheet",
              label: "Post sheet…",
              enabled: false,
              click: () => fileCommand("post-sheet"),
            },
            {
              id: "post-all",
              label: "Post all…",
              enabled: false,
              click: () => fileCommand("post-all"),
            },
            { type: "separator" },
            { role: "quit" },
          ],
        },
        {
          label: "Edit",
          submenu: [
            { role: "copy" },
            { role: "paste" },
            { type: "separator" },
            {
              label: "Select All",
              accelerator: "CmdOrCtrl+A",
              click: () => fileCommand("select-all"),
            },
          ],
        },
        {
          label: "View",
          submenu: [
            {
              label: "Commands…",
              accelerator: "CmdOrCtrl+K",
              click: () => fileCommand("commands"),
            },
            { type: "separator" },
            {
              label: "Machine settings...",
              click: () => fileCommand("machine-settings"),
            },
            {
              label: "Import settings...",
              click: () => fileCommand("import-settings"),
            },
            {
              label: "Display units",
              submenu: [
                {
                  id: "units-mm",
                  label: "Millimeters (mm)",
                  type: "radio",
                  checked: true,
                  click: () => fileCommand("units-mm"),
                },
                {
                  id: "units-in",
                  label: "Inches (in)",
                  type: "radio",
                  click: () => fileCommand("units-in"),
                },
              ],
            },
            {
              id: "file-labels",
              label: "Show file labels",
              type: "checkbox",
              checked: true,
              click: () => fileCommand("toggle-labels"),
            },
            { type: "separator" },
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
            { type: "separator" },
            { role: "togglefullscreen" },
          ],
        },
        {
          label: "Help",
          submenu: [
            {
              id: "github-update",
              label: "Update from GitHub…",
              click: () => {
                void checkForUpdates();
              },
            },
            { type: "separator" },
            {
              label: "About Wam Local",
              click: () => {
                void dialog.showMessageBox(win, {
                  type: "info",
                  title: "Wam Local",
                  message: `Wam Local ${app.getVersion()}`,
                  detail:
                    "Independent waterjet design and CAM workbench.\nAudacityMicro/WamLocal",
                  buttons: ["OK"],
                });
              },
            },
          ],
        },
      ]),
    );
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
