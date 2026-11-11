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
        !details.url.startsWith("devtools:"),
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
  const {
    readLibraryFile,
    writeLibraryFile,
  } = require("../dist-electron/library.cjs");
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
  ipcMain.handle("wam:materials-load", (event) => {
    checkLibrarySender(event);
    return readLibraryFile(materialFile);
  });
  ipcMain.handle("wam:materials-save", (event, value) => {
    checkLibrarySender(event);
    return writeLibraryFile(materialFile, value);
  });
  const checkForUpdates = createUpdateAction({
    app,
    dialog,
    updater: autoUpdater,
    getWindow: () => win,
    setMenuState: (enabled, label) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById("github-update");
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
      { label: "File", submenu: [{ role: "quit" }] },
      { label: "Edit", submenu: [{ role: "copy" }, { role: "paste" }] },
      {
        label: "View",
        submenu: [
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
