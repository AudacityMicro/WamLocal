import { nestJobDetailed } from "../core/job-nesting";
import { nestSheetDetailed } from "../core/sheet-nesting";
self.onmessage = (e) => {
  try {
    const progress = (progress: unknown, checkpoint?: unknown) =>
      self.postMessage({ type: "progress", progress, checkpoint });
    if (e.data.kind === "job") {
      const { job, ...report } = nestJobDetailed(e.data.value, e.data.rotate, {
        onProgress: progress,
      });
      self.postMessage({ ok: true, value: job, report });
    } else
      self.postMessage({
        ok: true,
        ...nestSheetDetailed(e.data.value, e.data.rotate, progress),
      });
  } catch (error) {
    self.postMessage({ ok: false, error: (error as Error).message });
  }
};
