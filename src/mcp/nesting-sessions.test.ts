import { it, expect, vi, beforeEach } from "vitest";
import { newJob } from "../core/job";
import { makePart, rectangle } from "../core/model";
const { workers } = vi.hoisted(() => ({ workers: [] as any[] }));
vi.mock("node:worker_threads", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    Worker: class extends EventEmitter {
      constructor() {
        super();
        workers.push(this);
      }
      unref() {}
      terminate() {
        this.emit("exit", 1);
        return Promise.resolve(1);
      }
    },
  };
});
import { NestingSessions } from "./nesting-sessions";
beforeEach(() => {
  workers.length = 0;
});
function fixture() {
  let job = newJob();
  const p = {
    ...makePart("Plate", [rectangle(20, 10)]),
    materialId: job.materials[0].id,
    quantity: 1,
  };
  job.parts = [p];
  const original = structuredClone(job),
    checkpoint = {
      ...job,
      sheets: job.sheets.map((s) => ({
        ...s,
        placements: [
          {
            id: "placement",
            partId: p.id,
            x: 12,
            y: 12,
            rotation: 0,
            scale: 1,
          },
        ],
      })),
    };
  const save = vi.fn(
    async (_file: string, next: typeof job) => (job = structuredClone(next)),
  );
  const sessions = new NestingSessions({
    read: async () => structuredClone(job),
    save,
    serial: (fn) => fn(),
  });
  return {
    sessions,
    save,
    original,
    checkpoint,
    change: () => {
      job = { ...job, name: "Externally edited" };
    },
  };
}
it("keeps a validated checkpoint when stopping and exposes it as saved", async () => {
  const f = fixture(),
    state = await f.sessions.start("test.wam", f.original);
  workers[0].emit("message", {
    type: "progress",
    progress: { placed: 1 },
    checkpoint: f.checkpoint,
  });
  const stopped = await f.sessions.stop(state.searchId, true);
  expect(stopped).toMatchObject({
    status: "cancelled",
    saved: true,
    hasCheckpoint: true,
  });
  expect(f.save).toHaveBeenCalledWith("test.wam", f.checkpoint);
});
it("cancels without saving a checkpoint and ignores late completion", async () => {
  const f = fixture(),
    state = await f.sessions.start("test.wam", f.original);
  workers[0].emit("message", { type: "progress", checkpoint: f.checkpoint });
  await f.sessions.stop(state.searchId, false);
  workers[0].emit("message", {
    type: "done",
    job: f.checkpoint,
    report: { placed: 1 },
  });
  expect(f.save).not.toHaveBeenCalled();
  expect(f.sessions.status(state.searchId).status).toBe("cancelled");
});
it("does not overwrite newer file edits when keeping a checkpoint", async () => {
  const f = fixture(),
    state = await f.sessions.start("test.wam", f.original);
  workers[0].emit("message", { type: "progress", checkpoint: f.checkpoint });
  f.change();
  expect(await f.sessions.stop(state.searchId, true)).toMatchObject({
    status: "conflict",
    saved: false,
  });
  expect(f.save).not.toHaveBeenCalled();
});
it("compares against the original file when search settings differ from saved settings", async () => {
  const f = fixture(),
    input = {
      ...f.original,
      nesting: {
        rotationStep: 45,
        budgetSeconds: 1,
        insideHoles: false,
        optimize: false,
      },
    };
  const state = await f.sessions.start(
    "test.wam",
    input,
    undefined,
    undefined,
    f.original,
  );
  workers[0].emit("message", {
    type: "done",
    job: { ...f.checkpoint, nesting: input.nesting },
    report: { placed: 1 },
  });
  await vi.waitFor(() =>
    expect(f.sessions.status(state.searchId).status).toBe("completed"),
  );
  expect(f.save).toHaveBeenCalledOnce();
  expect(f.sessions.status(state.searchId).saved).toBe(true);
});
