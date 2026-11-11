import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { describe, it, expect, vi } from "vitest";
const { createUpdateAction, UPDATE_FEED } = createRequire(import.meta.url)(
  "../../electron/updates.cjs",
);

function harness(responses: number[] = [], packaged = true) {
  const updater = Object.assign(new EventEmitter(), {
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(async () => ({
      isUpdateAvailable: true,
      updateInfo: { version: "0.2.0" },
    })),
    downloadUpdate: vi.fn(async () => ["verified-installer.exe"]),
    quitAndInstall: vi.fn(),
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: true,
    allowDowngrade: true,
    disableWebInstaller: false,
  });
  const dialog = {
    showMessageBox: vi.fn(async (..._args: unknown[]) => ({
      response: responses.shift() ?? 1,
    })),
  };
  const setMenuState = vi.fn();
  const check = createUpdateAction({
    app: { isPackaged: packaged, getVersion: () => "0.1.0" },
    dialog,
    updater,
    getWindow: () => ({ isDestroyed: () => false }),
    setMenuState,
  });
  return { updater, dialog, setMenuState, check };
}
describe("GitHub update menu action", () => {
  it("pins the repository and does not check, download or install at startup", () => {
    const { updater } = harness();
    expect(updater.setFeedURL).toHaveBeenCalledWith(UPDATE_FEED);
    expect(UPDATE_FEED.owner + "/" + UPDATE_FEED.repo).toBe(
      "AudacityMicro/WamLocal",
    );
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.allowPrerelease).toBe(false);
    expect(updater.allowDowngrade).toBe(false);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });
  it("does not contact GitHub for development builds", async () => {
    const h = harness([], false);
    await h.check();
    expect(h.updater.checkForUpdates).not.toHaveBeenCalled();
    expect(h.dialog.showMessageBox.mock.calls[0][1]).toMatchObject({
      message: "Updates are available in the packaged Windows app",
    });
  });
  it("lets the user decline the download", async () => {
    const h = harness([1]);
    await h.check();
    expect(h.updater.downloadUpdate).not.toHaveBeenCalled();
    expect(h.updater.quitAndInstall).not.toHaveBeenCalled();
    expect(h.setMenuState).toHaveBeenLastCalledWith(
      true,
      "Update from GitHub…",
    );
  });
  it("requires a separate install decision and supports installing later in the same session", async () => {
    const h = harness([0, 1, 0]);
    await h.check();
    expect(h.updater.downloadUpdate).toHaveBeenCalledOnce();
    expect(h.updater.quitAndInstall).not.toHaveBeenCalled();
    await h.check();
    expect(h.updater.checkForUpdates).toHaveBeenCalledOnce();
    expect(h.updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });
  it("reports a successful no-update check without downloading", async () => {
    const h = harness();
    h.updater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: false,
      updateInfo: { version: "0.1.0" },
    });
    await h.check();
    expect(h.dialog.showMessageBox.mock.calls[0][1]).toMatchObject({
      message: "Wam Local is up to date",
    });
    expect(h.updater.downloadUpdate).not.toHaveBeenCalled();
  });
  it("does not mistake missing releases or a network failure for an up-to-date app", async () => {
    for (const error of [
      Object.assign(Error("No published versions on GitHub"), {
        code: "ERR_UPDATER_NO_PUBLISHED_VERSIONS",
      }),
      Error("offline"),
    ]) {
      const h = harness();
      h.updater.checkForUpdates.mockRejectedValue(error);
      await h.check();
      expect(h.dialog.showMessageBox.mock.calls[0][1]).toMatchObject({
        message: "Update unavailable",
      });
      expect(h.updater.downloadUpdate).not.toHaveBeenCalled();
      expect(h.setMenuState).toHaveBeenLastCalledWith(
        true,
        "Update from GitHub…",
      );
    }
  });
  it("does not install a failed checksum download and reports the failure once", async () => {
    const h = harness([0]);
    const failure = Object.assign(Error("sha512 mismatch"), {
      code: "ERR_CHECKSUM_MISMATCH",
    });
    h.updater.downloadUpdate.mockImplementation(async () => {
      h.updater.emit("error", failure);
      throw failure;
    });
    await h.check();
    expect(h.updater.quitAndInstall).not.toHaveBeenCalled();
    expect(h.dialog.showMessageBox.mock.calls.at(-1)?.[1]).toMatchObject({
      detail: expect.stringContaining("could not be verified"),
    });
    expect(h.dialog.showMessageBox).toHaveBeenCalledTimes(2);
  });
  it("serializes repeated menu activations", async () => {
    const h = harness();
    let finish!: (value: any) => void;
    h.updater.checkForUpdates.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = h.check();
    await h.check();
    expect(h.updater.checkForUpdates).toHaveBeenCalledOnce();
    finish({ isUpdateAvailable: false, updateInfo: { version: "0.1.0" } });
    await first;
  });
});
