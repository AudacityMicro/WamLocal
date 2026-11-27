import { importDxf } from "../core/import";
import { importSvgArtwork } from "../core/svg-artwork";
import {
  embedSvgAssets,
  loadDxfImages,
  decodeRaster,
} from "../core/import-assets";
import { decodeDxf } from "../core/dxf-decode";
import type { ImportSettings } from "../core/import-settings";
declare global {
  interface Window {
    camImport: {
      load(): Promise<{
        name: string;
        data: string;
        unit: "mm" | "in";
        settings: ImportSettings;
        stepFaceId?: string;
      }>;
      resolve(reference: string): Promise<string | null>;
      finish(result: unknown): void;
    };
  }
}
try {
  const input = await window.camImport.load(),
    notices: string[] = [];
  const resolve = (reference: string) =>
    reference.startsWith("data:")
      ? Promise.resolve(reference)
      : window.camImport.resolve(reference);
  const bytes = Uint8Array.from(atob(input.data), (c) => c.charCodeAt(0));
  let part;
  if (/\.(step|stp)$/i.test(input.name)) {
    const { importStep } = await import("../core/import-step");
    part = await importStep(
      bytes.buffer,
      input.name,
      input.settings.curveToleranceMm,
      input.stepFaceId,
    );
    if (part.stepSource!.bodyCount > 1)
      notices.push(
        "Multiple bodies: only the selected face was imported; use stepFaceId to choose another body/face.",
      );
    notices.push(
      "Face openings may include blind pockets. Review intended through-cuts before posting.",
    );
  } else if (/\.dxf$/i.test(input.name)) {
    const source = decodeDxf(bytes.buffer);
    part = importDxf(
      source,
      input.name,
      input.unit,
      (m) => notices.push(m),
      input.settings.curveToleranceMm,
      input.settings,
      await loadDxfImages(source, resolve),
    );
  } else if (/\.svg$/i.test(input.name)) {
    part = await importSvgArtwork(
      await embedSvgAssets(new TextDecoder().decode(bytes), resolve),
      input.name,
      input.settings,
      (m) => notices.push(m),
    );
  } else {
    const type: Record<string, string> = {
      png: "png",
      jpg: "jpeg",
      jpeg: "jpeg",
      gif: "gif",
      webp: "webp",
      bmp: "bmp",
    };
    const extension = input.name.split(".").at(-1)!.toLowerCase();
    if (!type[extension])
      throw Error(
        "Supported inputs: STEP, STP, SVG, DXF, PNG, JPEG, GIF, WebP and BMP.",
      );
    const data = `data:image/${type[extension]};base64,${input.data}`,
      image = await decodeRaster(data);
    part = await importSvgArtwork(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${(image.width * 25.4) / 96}mm" height="${(image.height * 25.4) / 96}mm" viewBox="0 0 ${image.width} ${image.height}"><image width="${image.width}" height="${image.height}" href="${data}"/></svg>`,
      input.name,
      input.settings,
      (m) => notices.push(m),
    );
    notices.push("Raster dimensions assume 96 pixels/inch.");
  }
  window.camImport.finish({ part, notices });
} catch (error) {
  window.camImport.finish({ error: (error as Error).message });
}
