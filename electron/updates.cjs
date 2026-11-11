const UPDATE_FEED = Object.freeze({
  provider: "github",
  owner: "AudacityMicro",
  repo: "WamLocal",
  releaseType: "release",
});

function updateFailure(error) {
  const code = error?.code || "";
  const message = String(error?.message || "");
  if (
    code === "ERR_UPDATER_NO_PUBLISHED_VERSIONS" ||
    /no published versions/i.test(message)
  )
    return "No update releases have been published for AudacityMicro/WamLocal yet.";
  if (code === "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND")
    return "The latest GitHub release is missing its Windows update metadata (latest.yml). No update was installed.";
  if (/checksum|sha512|signature/i.test(code + message))
    return "The update could not be verified. No update was installed. Try again after the release has been corrected.";
  return "Could not check or download updates from GitHub. Check your connection and try again. The repository and its release assets must be publicly accessible. No update was installed.";
}

/** Main-process only. No startup checks, renderer IPC, embedded tokens or silent installs. */
function createUpdateAction({ app, dialog, updater, getWindow, setMenuState }) {
  updater.setFeedURL(UPDATE_FEED);
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.disableWebInstaller = true;
  let busy = false;
  let downloadedVersion;
  // electron-updater also emits errors for rejected promises; consume the event
  // and report the awaited failure once through the dialog below.
  updater.on("error", () => {});
  updater.on("download-progress", (progress) => {
    if (busy)
      setMenuState(
        false,
        `Downloading update… ${Math.floor(progress.percent)}%`,
      );
  });
  const show = (options) => {
    const win = getWindow();
    return win && !win.isDestroyed()
      ? dialog.showMessageBox(win, options)
      : dialog.showMessageBox(options);
  };
  async function offerInstall() {
    const choice = await show({
      type: "info",
      title: "Update from GitHub",
      message: `Wam Local ${downloadedVersion} is ready to install`,
      detail:
        "Save any open project files first. Wam Local will close and open the Windows installer. An unpacked or portable copy is upgraded by installing the new version; the installer creates the desktop shortcut.",
      buttons: ["Install and restart", "Later"],
      defaultId: 1,
      cancelId: 1,
    });
    if (choice.response === 0) updater.quitAndInstall(false, true);
  }
  return async function checkForUpdates() {
    if (busy) return;
    busy = true;
    setMenuState(false, "Checking GitHub…");
    try {
      if (!app.isPackaged) {
        await show({
          type: "info",
          title: "Update from GitHub",
          message: "Updates are available in the packaged Windows app",
          detail:
            "Development builds run from your local source. Build or install Wam Local to check for GitHub releases.",
          buttons: ["OK"],
        });
        return;
      }
      if (downloadedVersion) {
        await offerInstall();
        return;
      }
      const result = await updater.checkForUpdates();
      if (!result) throw Error("Update check returned no result");
      if (!result.isUpdateAvailable) {
        await show({
          type: "info",
          title: "Update from GitHub",
          message: "Wam Local is up to date",
          detail: `Current version: ${app.getVersion()}\nSource: AudacityMicro/WamLocal · stable releases`,
          buttons: ["OK"],
        });
        return;
      }
      const choice = await show({
        type: "info",
        title: "Update from GitHub",
        message: `Wam Local ${result.updateInfo.version} is available`,
        detail: `Current version: ${app.getVersion()}\nDownload the Windows installer from AudacityMicro/WamLocal on GitHub? Your projects stay on this computer.`,
        buttons: ["Download update", "Cancel"],
        defaultId: 1,
        cancelId: 1,
      });
      if (choice.response !== 0) return;
      setMenuState(false, "Downloading update…");
      const files = await updater.downloadUpdate();
      if (!files?.length) throw Error("Update download returned no files");
      downloadedVersion = result.updateInfo.version;
      await offerInstall();
    } catch (error) {
      await show({
        type: "warning",
        title: "Update from GitHub",
        message: "Update unavailable",
        detail: updateFailure(error),
        buttons: ["OK"],
      });
    } finally {
      busy = false;
      setMenuState(true, "Update from GitHub…");
    }
  };
}

module.exports = { UPDATE_FEED, createUpdateAction, updateFailure };
