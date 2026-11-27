import { parentPort, workerData } from "node:worker_threads";
import { nestJobDetailed } from "../core/job-nesting";
import { nestSheetDetailed } from "../core/sheet-nesting";
import { sheetProject } from "../core/job";
import { editView } from "../core/job-ops";
try {
  const progress = (progress: unknown, checkpoint?: unknown) =>
    parentPort!.postMessage({ type: "progress", progress, checkpoint });
  if (workerData.sheetId) {
    const result = nestSheetDetailed(
      sheetProject(workerData.job, workerData.sheetId),
      workerData.rotate,
      progress,
    );
    parentPort!.postMessage({
      type: "done",
      job: editView(
        workerData.job,
        { kind: "sheet", id: workerData.sheetId },
        result.value,
      ),
      report: result.report,
    });
  } else {
    const { job, ...report } = nestJobDetailed(
      workerData.job,
      workerData.rotate,
      { onProgress: progress },
    );
    parentPort!.postMessage({ type: "done", job, report });
  }
} catch (error) {
  parentPort!.postMessage({ type: "error", error: (error as Error).message });
}
