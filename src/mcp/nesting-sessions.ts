import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { id } from "../core/model";
import { jobSchema, type Job } from "../core/job";
import { editView } from "../core/job-ops";
type State = {
  searchId: string;
  file: string;
  status: "running" | "completed" | "cancelled" | "failed" | "conflict";
  progress?: unknown;
  report?: unknown;
  error?: string;
  saved: boolean;
  original: Job;
  checkpoint?: Job;
  worker: Worker;
  sheetId?: string;
};
export class NestingSessions {
  private sessions = new Map<string, State>();
  constructor(
    private io: {
      read(file: string): Promise<Job>;
      save(file: string, job: Job): Promise<Job>;
      serial<T>(fn: () => Promise<T>): Promise<T>;
    },
  ) {}
  async start(
    file: string,
    job: Job,
    rotate?: boolean,
    sheetId?: string,
    source = job,
  ) {
    if (
      [...this.sessions.values()].some(
        (s) => s.file === file && s.status === "running",
      )
    )
      throw Error("This job already has a running search");
    if (
      [...this.sessions.values()].filter((s) => s.status === "running")
        .length >= 4
    )
      throw Error("At most four searches may run at once");
    if (sheetId && !job.sheets.some((s) => s.id === sheetId))
      throw Error("Unknown sheet ID");
    while (this.sessions.size >= 16) {
      const old = [...this.sessions.values()].find(
        (s) => s.status !== "running",
      );
      if (!old) break;
      this.sessions.delete(old.searchId);
    }
    const here = path.dirname(fileURLToPath(import.meta.url));
    const script = path.resolve(
      here,
      here.endsWith(path.sep + "mcp")
        ? "../../dist-mcp/nesting-worker.mjs"
        : "nesting-worker.mjs",
    );
    const worker = new Worker(script, { workerData: { job, rotate, sheetId } });
    const state: State = {
      searchId: id(),
      file,
      status: "running",
      saved: false,
      original: source,
      worker,
      sheetId,
    };
    this.sessions.set(state.searchId, state);
    worker.on("message", (message) => {
      if (state.status !== "running") return;
      try {
        if (message.type === "progress") {
          state.progress = message.progress;
          if (message.checkpoint)
            state.checkpoint = sheetId
              ? editView(
                  job,
                  { kind: "sheet", id: sheetId },
                  message.checkpoint,
                )
              : jobSchema.parse(message.checkpoint);
        } else if (message.type === "error") {
          state.status = "failed";
          state.error = message.error;
        } else if (message.type === "done")
          void this.io
            .serial(async () => {
              if (state.status !== "running") return;
              state.checkpoint = jobSchema.parse(message.job);
              state.report = message.report;
              await this.commit(state, "completed");
            })
            .catch((error) => {
              state.status = "failed";
              state.error = error.message;
            });
      } catch (error) {
        state.status = "failed";
        state.error = (error as Error).message;
        void worker.terminate();
      }
    });
    worker.on("error", (error) => {
      if (state.status === "running") {
        state.status = "failed";
        state.error = error.message;
      }
    });
    worker.on("exit", (code) => {
      if (code !== 0 && state.status === "running") {
        state.status = "failed";
        state.error = `Search worker exited (${code})`;
      }
    });
    worker.unref();
    return this.describe(state);
  }
  status(searchId: string) {
    return this.describe(this.get(searchId));
  }
  async stop(searchId: string, keepBest: boolean) {
    const state = this.get(searchId);
    if (state.status !== "running") return this.describe(state);
    // Change state before termination so an already queued completion cannot save.
    state.status = "cancelled";
    await state.worker.terminate();
    if (keepBest && state.checkpoint) await this.commit(state, "cancelled");
    return this.describe(state);
  }
  private get(id: string) {
    const state = this.sessions.get(id);
    if (!state)
      throw Error(
        "Unknown nesting search ID (searches belong to this MCP session)",
      );
    return state;
  }
  private async commit(state: State, status: "completed" | "cancelled") {
    const current = await this.io.read(state.file);
    if (JSON.stringify(current) !== JSON.stringify(state.original)) {
      state.status = "conflict";
      state.error =
        "Job changed during nesting; result was not written. Run a new search from the current job.";
      return;
    }
    if (state.checkpoint) {
      await this.io.save(state.file, state.checkpoint);
      state.saved = true;
    }
    state.status = status;
  }
  private describe(state: State) {
    return {
      searchId: state.searchId,
      file: state.file,
      status: state.status,
      saved: state.saved,
      hasCheckpoint: !!state.checkpoint,
      progress: state.progress,
      report: state.report,
      error: state.error,
    };
  }
}
