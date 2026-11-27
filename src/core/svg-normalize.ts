const NS = "http://www.w3.org/2000/svg";
/** Resolve local SVG instances without loading fonts, images, scripts or external resources. */
export function prepareSvg(source: string,allowArtwork=false): Element {
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(source))
    throw Error("SVG entity declarations are not supported.");
  source = source.replace(/<!DOCTYPE[^>]*>/gi, "");
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  if (
    doc.querySelector("parsererror") ||
    doc.documentElement.localName !== "svg"
  )
    throw Error("Invalid SVG file.");
  const root = doc.documentElement;
  if (root.querySelectorAll("*").length > 50000)
    throw Error("SVG is too complex (more than 50,000 elements).");
  const ids = new Map<string, Element>();
  for (const el of Array.from(root.querySelectorAll("[id]")))
    ids.set(el.id, el);
  let count = 0;
  function expand(node: Element, stack: string[] = []): Element {
    if (++count > 50000 || stack.length > 32)
      throw Error("SVG references are too complex.");
    if (node.localName === "use") {
      const href =
        node.getAttribute("href") ??
        node.getAttributeNS("http://www.w3.org/1999/xlink", "href") ??
        "";
      if (!href.startsWith("#"))
        throw Error(
          "SVG references must point to objects inside the same file.",
        );
      const key = decodeURIComponent(href.slice(1));
      if (stack.includes(key))
        throw Error("SVG contains a circular object reference.");
      const target = ids.get(key);
      if (!target) throw Error(`SVG references a missing object: ${key}`);
      const g = doc.createElementNS(NS, "g");
      for (const a of Array.from(node.attributes))
        if (
          ![
            "href",
            "xlink:href",
            "x",
            "y",
            "width",
            "height",
            "transform",
            "id",
          ].includes(a.name)
        )
          g.setAttribute(a.name, a.value);
      g.setAttribute(
        "transform",
        `${node.getAttribute("transform") ?? ""} translate(${Number(node.getAttribute("x") ?? 0)},${Number(node.getAttribute("y") ?? 0)})`,
      );
      if (target.localName === "symbol") {
        const svg = doc.createElementNS(NS, "svg");
        for (const a of Array.from(target.attributes))
          if (a.name !== "id") svg.setAttribute(a.name, a.value);
        for (const key of ["width", "height"])
          if (node.hasAttribute(key))
            svg.setAttribute(key, node.getAttribute(key)!);
        for (const c of Array.from(target.children))
          svg.appendChild(expand(c, [...stack, key]));
        g.appendChild(svg);
      } else g.appendChild(expand(target, [...stack, key]));
      return g;
    }
    const copy =
      node.namespaceURI === NS
        ? doc.createElementNS(NS, node.localName === "a" ? "g" : node.localName)
        : (node.cloneNode(false) as Element);
    if (node.namespaceURI === NS)
      for (const a of Array.from(node.attributes))
        if (!(node.localName === "a" && /href/i.test(a.name)))
          copy.setAttributeNS(a.namespaceURI, a.name, a.value);
    for (const child of Array.from(node.childNodes))
      copy.appendChild(
        child.nodeType === 1
          ? expand(child as Element, stack)
          : child.cloneNode(true),
      );
    return copy;
  }
  const svg = expand(root);
  const allowed = new Set([
    "svg",
    "g",
    "path",
    "rect",
    "circle",
    "ellipse",
    "polygon",
    "polyline",
    "line",
    "defs",
    "symbol",
    "style",
    "clipPath",
    "linearGradient",
    "radialGradient",
    "stop",
    "title",
    "desc",
  ]);
  if(allowArtwork)for(const tag of ['text','tspan','textPath','image','foreignObject','mask','filter','a','switch','marker','pattern'])allowed.add(tag);
  for (const el of [svg, ...Array.from(svg.querySelectorAll("*"))]) {
    if (
      (el.namespaceURI && el.namespaceURI !== NS) ||
      ["metadata", "script", "animate", "animateTransform", "set"].includes(
        el.localName,
      )
    ) {
      el.remove();
      continue;
    }
    if (!allowed.has(el.localName)&&!(allowArtwork&&el.localName.startsWith('fe'))) {
      if (el.closest("defs") && !el.closest("clipPath")) {
        el.remove();
        continue;
      }
      if (["text", "tspan", "image", "foreignObject"].includes(el.localName))
        throw Error(
          `SVG contains <${el.localName}> artwork without cuttable outlines. Convert text to paths or trace images before importing.`,
        );
      throw Error(
        `SVG <${el.localName}> cannot be converted to cut geometry yet.`,
      );
    }
    for (const a of Array.from(el.attributes)) {
      if (/^on/i.test(a.name) || a.name === "data-paper-data")
        el.removeAttribute(a.name);
      if (/href/i.test(a.name) && !a.value.startsWith("#")&&!(allowArtwork&&/^data:image\//i.test(a.value)))
        throw Error(
          "External SVG resources are not supported. Embed the vector geometry in the file.",
        );
      for (const match of a.value.matchAll(/url\s*\(\s*['"]?([^'"\s)]+)/gi))
        if (!match[1].startsWith("#")&&!(allowArtwork&&/^data:(image|font|application\/(x-font|font))/i.test(match[1])))
          throw Error("External SVG resources are not supported.");
      if (!allowArtwork&&a.name === "mask" && a.value !== "none")
        throw Error(
          "SVG masks must be converted to vector paths before importing.",
        );
    }
    if (el.localName === "style") {
      const css = el.textContent ?? "";
      if (/@import/i.test(css)||(!allowArtwork&&/@font-face|\bmask\s*:/i.test(css)))
        throw Error(
          "SVG styles require external fonts/resources or unsupported masks.",
        );
      for (const m of css.matchAll(/url\s*\(\s*['"]?([^'"\s)]+)/gi))
        if (!m[1].startsWith("#")&&!(allowArtwork&&/^data:(image|font|application\/(x-font|font))/i.test(m[1])))
          throw Error("SVG styles contain external resources.");
    }
  }
  for (const style of Array.from(svg.querySelectorAll("style"))) {
    for (const rule of (style.textContent ?? "").matchAll(
      /([^{}]+)\{([^{}]*)\}/g,
    ))
      if (/display\s*:\s*none/i.test(rule[2])) {
        try {
          for (const el of Array.from(svg.querySelectorAll(rule[1].trim())))
            el.remove();
        } catch {}
      }
  }
  for (const el of Array.from(svg.querySelectorAll("*")))
    if (
      el.getAttribute("display") === "none" ||
      /display\s*:\s*none/i.test(el.getAttribute("style") ?? "")
    )
      el.remove();
  if (svg.querySelector('clipPath[clipPathUnits="objectBoundingBox"]')) {
    const host = document.createElement("div");
    host.style.cssText =
      "position:fixed;left:-100000px;top:0;pointer-events:none";
    document.body.appendChild(host);
    host.appendChild(svg);
    try {
      let serial = 0;
      for (const el of Array.from(svg.querySelectorAll("*"))) {
        const value =
          el.getAttribute("clip-path") ??
          (el as SVGElement).style?.clipPath ??
          "";
        const ref = value.match(/url\(\s*['"]?#([^'"\s)]+)/);
        const clip = ref
          ? Array.from(svg.querySelectorAll("clipPath")).find(
              (c) => c.id === ref[1],
            )
          : undefined;
        if (!clip || clip.getAttribute("clipPathUnits") !== "objectBoundingBox")
          continue;
        const graphics = el as SVGGraphicsElement;
        if (typeof graphics.getBBox !== "function")
          throw Error("This SVG clip requires browser geometry support.");
        const b = graphics.getBBox(),
          copy = clip.cloneNode(true) as Element;
        copy.id = `wam-clip-${++serial}`;
        copy.setAttribute("clipPathUnits", "userSpaceOnUse");
        copy.setAttribute(
          "transform",
          `translate(${b.x},${b.y}) scale(${b.width},${b.height}) ${clip.getAttribute("transform") ?? ""}`,
        );
        clip.parentElement!.appendChild(copy);
        el.setAttribute("clip-path", `url(#${copy.id})`);
        (el as SVGElement).style?.setProperty("clip-path", `url(#${copy.id})`);
      }
    } finally {
      host.remove();
    }
  }
  return svg;
}
