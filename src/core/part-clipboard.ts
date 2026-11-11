import { z } from "zod";
import {
  id,
  partSchema,
  projectSchema,
  type Part,
  type Project,
} from "./model";

export const PART_CLIPBOARD_MIME = "application/x-wam-local-parts+json";
const clipboardSchema = z.object({
  format: z.literal("wam-local-parts"),
  version: z.literal(1),
  units: z.literal("mm"),
  parts: z.array(partSchema).min(1).max(2000),
});
const MAX_TEXT_LENGTH = 10_000_000;
export function encodePartClipboard(parts: Part[]): string {
  const text = JSON.stringify(
    clipboardSchema.parse({
      format: "wam-local-parts",
      version: 1,
      units: "mm",
      parts,
    }),
  );
  if (text.length > MAX_TEXT_LENGTH)
    throw Error("Selected geometry exceeds the 10 MB clipboard limit.");
  return text;
}
export function pastePartClipboard(
  project: Project,
  text: string,
  sequence = 1,
): { project: Project; ids: string[] } {
  if (text.length > MAX_TEXT_LENGTH)
    throw Error("Clipboard exceeds the 10 MB limit.");
  if (!Number.isSafeInteger(sequence) || sequence < 1)
    throw Error("Invalid paste offset.");
  const decoded = (() => {
    try {
      return clipboardSchema.parse(JSON.parse(text));
    } catch {
      throw Error(
        "Clipboard does not contain Wam Local parts. Copy a part in Wam Local first.",
      );
    }
  })();
  const parts = decoded.parts.map((p) => ({
    ...p,
    id: id(),
    name: `${p.name} copy`,
    x: p.x + 8 * sequence,
    y: p.y + 8 * sequence,
  }));
  if (project.parts.length + parts.length > 2000)
    throw Error("Pasting would exceed the 2,000-part project limit.");
  return {
    project: projectSchema.parse({
      ...project,
      parts: [...project.parts, ...parts],
    }),
    ids: parts.map((p) => p.id),
  };
}

export function isTextEditingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
    )
  );
}
