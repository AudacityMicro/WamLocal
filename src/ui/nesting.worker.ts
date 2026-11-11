import { nest } from "../core/geometry";
import { nestJob } from "../core/job-ops";
self.onmessage = (e) => {
  try {
    self.postMessage({
      ok: true,
      value:
        e.data.kind === "job"
          ? nestJob(e.data.value, e.data.rotate)
          : nest(e.data.value, e.data.rotate),
    });
  } catch (error) {
    self.postMessage({ ok: false, error: (error as Error).message });
  }
};
