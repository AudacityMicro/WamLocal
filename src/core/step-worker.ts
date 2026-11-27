import init from "occt-import-js";
import wasmUrl from "occt-import-js/dist/occt-import-js.wasm?url";
import { stepPart } from "./step-import";

self.onmessage = async (
  event: MessageEvent<{
    data: ArrayBuffer;
    name: string;
    toleranceMm: number;
    faceId?: string;
  }>,
) => {
  try {
    const kernel = await init({
      wasmBinary: new Uint8Array(await (await fetch(wasmUrl)).arrayBuffer()),
      print: () => {},
      printErr: () => {},
    });
    const { data, name, toleranceMm, faceId } = event.data;
    const result = kernel.ReadStepFile(new Uint8Array(data), {
      linearUnit: "millimeter",
      linearDeflectionType: "absolute_value",
      linearDeflection: toleranceMm,
      angularDeflection: 0.1,
    });
    self.postMessage({ part: stepPart(name, result, toleranceMm, faceId) });
  } catch (error) {
    self.postMessage({ error: (error as Error).message });
  }
};
