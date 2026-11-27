import { prepareSvg } from "./svg-normalize";
import { importSvg } from "./import";
import { tracePixels } from "./artwork-trace";
import { defaultImportSettings, type ImportSettings } from "./import-settings";
import { bounds } from "./geometry";
import { makePart, type Contour } from "./model";
import { classifyImportedContours } from "./import-contours";

const NS = "http://www.w3.org/2000/svg";
const serialize = (el: Element) => new XMLSerializer().serializeToString(el);
const mm = (value: string | null, fallback: number) => {
  const m = (value ?? "").match(/^([\d.eE+-]+)\s*(mm|cm|in|px|pt|pc)?$/i);
  return m
    ? Number(m[1]) *
        { mm: 1, cm: 10, in: 25.4, px: 25.4 / 96, pt: 25.4 / 72, pc: 25.4 / 6 }[
          (m[2]?.toLowerCase() ?? "px") as "mm"
        ]
    : fallback;
};

/** Keep CAD paths as vectors; rasterize only artwork needing appearance-based
 * outlining (text, embedded images, masks/filters and marker graphics). */
export async function importSvgArtwork(
  source: string,
  name: string,
  settings: ImportSettings = defaultImportSettings(),
  notice: (s: string) => void = () => {},
) {
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  // foreignObject text is rendered as SVG text, avoiding a tainted HTML canvas.
  for (const foreign of Array.from(doc.querySelectorAll("foreignObject"))) {
    foreign.querySelectorAll("script,iframe,object").forEach((e) => e.remove());
    const text = doc.createElementNS(NS, "text");
    text.setAttribute("x", foreign.getAttribute("x") ?? "0");
    text.setAttribute("y", String(Number(foreign.getAttribute("y") ?? 0) + 16));
    if (foreign.hasAttribute("transform"))
      text.setAttribute("transform", foreign.getAttribute("transform")!);
    text.setAttribute("font-size", "16");
    text.textContent = foreign.textContent ?? "";
    foreign.replaceWith(text);
    notice("Converted foreign-object text using SVG text layout.");
  }
  const svg = prepareSvg(serialize(doc.documentElement), true);
  // Navigation groups carry geometry but are not useful as links in cut files.
  for (const a of Array.from(svg.querySelectorAll("a"))) {
    const g = doc.createElementNS(NS, "g");
    for (const attr of Array.from(a.attributes))
      if (!/href/.test(attr.name)) g.setAttribute(attr.name, attr.value);
    while (a.firstChild) g.appendChild(a.firstChild);
    a.replaceWith(g);
  }
  for (const style of Array.from(svg.querySelectorAll("style")))
    for (const rule of (style.textContent ?? "").matchAll(
      /([^{}]+)\{([^{}]*)\}/g,
    ))
      if (
        /(?:mask|filter|marker-start|marker-mid|marker-end)\s*:/i.test(rule[2])
      )
        try {
          for (const target of Array.from(svg.querySelectorAll(rule[1].trim())))
            target.setAttribute("data-wam-rasterize", "true");
        } catch {}
  for (const el of [svg, ...Array.from(svg.querySelectorAll("*"))])
    for (const attr of ["fill", "stroke"]) {
      const ref = el.getAttribute(attr)?.match(/url\(['"]?#([^'"\s)]+)/);
      if (
        ref &&
        Array.from(svg.querySelectorAll("pattern")).some((p) => p.id === ref[1])
      )
        el.setAttribute("data-wam-rasterize", "true");
    }
  const selectors =
    'text,image,[mask]:not([mask="none"]),[filter]:not([filter="none"]),[marker-start],[marker-mid],[marker-end],[data-wam-rasterize], [style*="mask:"], [style*="filter:"]';
  const rootArtwork = svg.matches(selectors);
  const targets = rootArtwork
    ? [svg]
    : Array.from(svg.querySelectorAll(selectors)).filter(
        (el) => !el.closest("defs,mask,filter,marker,pattern,clipPath"),
      );
  if (!targets.length)
    return importSvg(serialize(svg), name, settings.curveToleranceMm);
  const artwork = svg.cloneNode(true) as Element,
    vector = svg.cloneNode(true) as Element;
  const targetSet = new Set(targets);
  // Preserve ancestors (transforms, inherited styles) and definitions. Remove
  // ordinary geometry only from the artwork clone, so it is not imported twice.
  const prune = (original: Element, copy: Element) => {
    const children = Array.from(original.children),
      copies = Array.from(copy.children);
    children.forEach((child, i) => {
      const current = copies[i];
      if (!current) return;
      if (["defs", "style", "title", "desc"].includes(child.localName)) return;
      if (targetSet.has(child)) return;
      if (targets.some((t) => child.contains(t))) prune(child, current);
      else current.remove();
    });
  };
  if (!rootArtwork) prune(svg, artwork);
  if (rootArtwork) {
    vector.innerHTML = "";
    for (const attr of ["mask", "filter", "style", "data-wam-rasterize"])
      vector.removeAttribute(attr);
  }
  for (const el of Array.from(vector.querySelectorAll(selectors))) el.remove();
  vector
    .querySelectorAll(
      "mask,filter,marker,pattern,text,tspan,image,foreignObject",
    )
    .forEach((el) => el.remove());
  for (const style of Array.from(vector.querySelectorAll("style")))
    style.textContent = (style.textContent ?? "")
      .replace(
        /(?:mask|filter|marker-start|marker-mid|marker-end)\s*:[^;}]+;?/gi,
        "",
      )
      .replace(/@font-face\s*\{[^}]*\}/gi, "");
  let contours: Contour[] = [];
  try {
    contours = importSvg(
      serialize(vector),
      name,
      settings.curveToleranceMm,
      true,
    ).contours;
  } catch (e) {
    if (!/No supported vector geometry/.test((e as Error).message)) throw e;
  }
  const vb = (svg.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const widthMm = mm(svg.getAttribute("width"), ((vb[2] || 300) * 25.4) / 96),
    heightMm = mm(svg.getAttribute("height"), ((vb[3] || 150) * 25.4) / 96);
  if (!(widthMm > 0 && heightMm > 0))
    throw Error("SVG artwork has invalid physical dimensions.");
  let width = (widthMm * settings.traceDpi) / 25.4,
    height = (heightMm * settings.traceDpi) / 25.4;
  const shrink = Math.min(
    1,
    8192 / width,
    8192 / height,
    Math.sqrt(16000000 / (width * height)),
  );
  width = Math.max(1, Math.ceil(width * shrink));
  height = Math.max(1, Math.ceil(height * shrink));
  artwork.setAttribute("width", String(width));
  artwork.setAttribute("height", String(height));
  if (vb.length !== 4 || !vb.every(Number.isFinite))
    artwork.setAttribute(
      "viewBox",
      `0 0 ${(widthMm * 96) / 25.4} ${(heightMm * 96) / 25.4}`,
    );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw Error("Artwork tracing requires browser canvas support.");
  const image = new Image(),
    url = URL.createObjectURL(
      new Blob([serialize(artwork)], { type: "image/svg+xml" }),
    );
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(Error("SVG artwork decoding timed out.")),
        20000,
      );
      image.onload = () => {
        clearTimeout(timeout);
        resolve();
      };
      image.onerror = () => {
        clearTimeout(timeout);
        reject(
          Error(
            "SVG artwork could not be decoded. Embedded image/font data may be invalid.",
          ),
        );
      };
      image.src = url;
    });
    context.drawImage(image, 0, 0, width, height);
    const traced = tracePixels(
      context.getImageData(0, 0, width, height).data,
      width,
      height,
      widthMm / width,
      heightMm / height,
      settings,
    );
    if (!traced.length)
      throw Error(
        "Artwork has no dark outlines at the selected tracing threshold. Adjust the import darkness threshold in settings.",
      );
    contours.push(...traced);
  } finally {
    URL.revokeObjectURL(url);
  }
  if (contours.length > 1000)
    throw Error(
      "SVG artwork exceeds 1,000 contours. Adjust tracing settings or split the artwork.",
    );
  contours = classifyImportedContours(contours);
  const b = bounds(contours.flatMap((c) => c.points));
  notice(
    `Outlined SVG text/images and appearance effects at ${Math.round((width / widthMm) * 25.4)} DPI using a ${settings.traceThreshold}/255 darkness threshold. Text uses available local fonts. Check traced detail and font substitution.`,
  );
  return makePart(
    name,
    contours.map((c) => ({
      ...c,
      points: c.points.map((p) => ({ x: p.x - b.x, y: p.y - b.y })),
    })),
  );
}
