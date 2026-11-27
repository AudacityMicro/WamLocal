// A separate, invisible Chromium renderer gives MCP the editor's SVG/font/canvas pipeline.
const { app, BrowserWindow, ipcMain, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { resolveLocalImportAsset } = require("./import-assets.cjs");
const flagIndex = process.argv.indexOf("--wam-cam-import");
const requestFile = process.argv[flagIndex >= 0 ? flagIndex + 1 : 2];
app.setPath("userData", path.dirname(requestFile));
app.disableHardwareAcceleration();
app
  .whenReady()
  .then(async () => {
    const request = JSON.parse(await fs.readFile(requestFile, "utf8"));
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "mcp-import-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: "cam-mcp-import",
      },
    });
    session
      .fromPartition("cam-mcp-import")
      .webRequest.onBeforeRequest((details, callback) =>
        callback({ cancel: !/^(?:file:|data:|blob:)/i.test(details.url) }),
      );
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    const guard = (event) => {
      if (
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame
      )
        throw Error("Import sender rejected");
    };
    ipcMain.handle("cam-import:load", (event) => {
      guard(event);
      return request;
    });
    ipcMain.handle("cam-import:resolve", (event, reference) => {
      guard(event);
      return request.sourcePath
        ? resolveLocalImportAsset(request.sourcePath, reference)
        : null;
    });
    ipcMain.on("cam-import:finish", async (event, result) => {
      guard(event);
      try {
        await fs.writeFile(
          requestFile + ".result",
          JSON.stringify(result),
          "utf8",
        );
        app.exit(0);
      } catch (error) {
        process.stderr.write(error.message);
        app.exit(1);
      }
    });
    win.webContents.on("render-process-gone", () => {
      process.stderr.write("Import renderer stopped.");
      app.exit(1);
    });
    await win.loadFile(path.join(__dirname, "../dist/cam-import.html"));
  })
  .catch((error) => {
    process.stderr.write(error.message);
    app.exit(1);
  });
