declare module "occt-import-js" {
  export default function init(options?: {
    wasmBinary?: Uint8Array;
    print?: (message: string) => void;
    printErr?: (message: string) => void;
  }): Promise<{
    ReadStepFile(
      data: Uint8Array,
      params: {
        linearUnit: "millimeter";
        linearDeflectionType: "absolute_value";
        linearDeflection: number;
        angularDeflection: number;
      },
    ): import("./core/step-import").StepResult;
  }>;
}
