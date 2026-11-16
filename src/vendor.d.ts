declare module "clipper-lib" {
  const ClipperLib: any;
  export default ClipperLib;
}
declare module "paper/dist/paper-core" {
  import paper = require("paper");
  export = paper;
}
interface Window {
  jobFiles?: {
    open(): Promise<{ job: unknown; path: string } | null>;
    save(job: unknown, saveAs?: boolean): Promise<{ path: string } | null>;
    reset(): Promise<void>;
    confirmDiscard(): Promise<"save" | "discard" | "cancel">;
    updateViewPreferences(value: {
      units: "mm" | "in";
      showFileLabels: boolean;
    }): void;
    setDirty(dirty: boolean): void;
    close(): void;
    onCommand(callback: (command: string) => void): () => void;
  };
  materialDatabase?: {
    load(): Promise<unknown>;
    save(value: unknown): Promise<unknown>;
  };
  partClipboard?: { copy(text: string): Promise<void>; paste(): void };
}
