function registerPartClipboard({ ipcMain, clipboard, win }) {
  const allowed = (event) =>
    !win.isDestroyed() &&
    event.sender === win.webContents &&
    event.senderFrame === win.webContents.mainFrame;
  ipcMain.handle("wam:copy-part", (event, text) => {
    if (!allowed(event)) throw Error("Clipboard request rejected");
    if (typeof text !== "string" || text.length > 10_000_000)
      throw Error("Invalid part clipboard payload");
    const payload = JSON.parse(text);
    if (
      payload?.format !== "wam-local-parts" ||
      payload.version !== 1 ||
      payload.units !== "mm" ||
      !Array.isArray(payload.parts) ||
      !payload.parts.length ||
      payload.parts.length > 2000
    )
      throw Error("Invalid part clipboard payload");
    clipboard.writeText(text);
  });
  // Chromium dispatches a normal paste event to the editor. The renderer never
  // receives an unrestricted clipboard-read API through the preload bridge.
  ipcMain.on("wam:paste-parts", (event) => {
    if (allowed(event)) win.webContents.paste();
  });
}
module.exports = { registerPartClipboard };
