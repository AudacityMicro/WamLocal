import type { Part } from "./model";
import { importTolerance } from "./import-settings";

// Load CAD code only on demand and keep meshing off the editor's UI thread.
export function importStep(
  data: ArrayBuffer,
  name: string,
  toleranceMm = 0.01,
  faceId?: string,
): Promise<Part> {
  importTolerance(toleranceMm);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./step-worker.ts", import.meta.url), {
      type: "module",
    });
    const finish = (error?: Error, part?: Part) => {
      clearTimeout(timer);
      worker.terminate();
      error ? reject(error) : resolve(part!);
    };
    const timer = setTimeout(
      () =>
        finish(
          Error(
            "STEP conversion exceeded two minutes. Simplify the model or increase import tolerance.",
          ),
        ),
      120000,
    );
    worker.onerror = (e) =>
      finish(Error(e.message || "STEP converter could not start."));
    worker.onmessage = (e) =>
      e.data.error
        ? finish(Error(e.data.error))
        : finish(undefined, e.data.part);
    worker.postMessage({ data, name, toleranceMm, faceId }, [data]);
  });
}
