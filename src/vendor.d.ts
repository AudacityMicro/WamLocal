declare module "clipper-lib" {
  const ClipperLib: any;
  export default ClipperLib;
}
declare module "paper/dist/paper-core" {
  import paper = require("paper");
  export = paper;
}
interface Window {
  mcpSetup?:{load():Promise<import("./ui/mcp-guide").McpConnection>;copy(text:string):Promise<void>};
  importAssets?:{resolve:(file:File,reference:string)=>Promise<string|null>};
  jobFiles?: {
    open(documentId?: string): Promise<{ job: unknown; path: string } | null>;
    post(
      job: unknown,
      sheetId?: string,
    ): Promise<{
      paths: string[];
      sheets: {
        filename: string;
        sheetName: string;
        operations: number;
        seconds: number;
        warnings: string[];
      }[];
    } | null>;
    save(job: unknown, saveAs?: boolean, documentId?: string): Promise<{ path: string } | null>;
    reset(documentId?: string): Promise<void>;
    confirmDiscard(name?: string): Promise<"save" | "discard" | "cancel">;
    updateViewPreferences(value: {
      units: "mm" | "in";
      showFileLabels: boolean;
      canPostSheet?: boolean;
      canPostAll?: boolean;
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
