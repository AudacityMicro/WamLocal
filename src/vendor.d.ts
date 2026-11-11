declare module "clipper-lib" {
  const ClipperLib: any;
  export default ClipperLib;
}
declare module "paper/dist/paper-core" {
  import paper = require("paper");
  export = paper;
}
interface Window {
  materialDatabase?:{load():Promise<unknown>;save(value:unknown):Promise<unknown>};
  partClipboard?: { copy(text: string): Promise<void>; paste(): void };
}
