const reserved =
  /^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i;
export function safeFileStem(value: string) {
  let stem = value
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, "_")
    .replace(/\./g, "_")
    .replace(/\s+/g, " ")
    .trim();
  if (!stem) stem = "Job";
  if (reserved.test(stem)) stem = "Job - " + stem;
  let result = "",
    bytes = 0;
  for (const char of stem) {
    const size = new TextEncoder().encode(char).length;
    if (bytes + size > 160) break;
    result += char;
    bytes += size;
  }
  return result.trimEnd();
}
export function jobFilename(value: string) {
  return safeFileStem(value.replace(/\.wam$/i, "")) + ".wam";
}
export function downloadFilename(value: string) {
  const match = value.match(/\.([a-z0-9]+)$/i);
  return (
    safeFileStem(match ? value.slice(0, -match[0].length) : value) +
    (match ? "." + match[1] : "")
  );
}
export function cutFilename(
  jobName: string,
  sheetIndex: number,
  sheetCount: number,
) {
  const stem = safeFileStem(jobName.replace(/\.gcode$/i, ""));
  return `${stem}${sheetCount > 1 ? ` - Sheet ${sheetIndex}` : ""}.gcode`;
}
export function validCutFilename(name: string) {
  if (
    new TextEncoder().encode(name).length > 240 ||
    /[<>:"/\\|?*\x00-\x1f\x7f]/.test(name) ||
    !/^.+\.gcode$/i.test(name)
  )
    return false;
  const stem = name.slice(0, -6);
  return (
    !!stem.trim() &&
    !stem.includes(".") &&
    !stem.startsWith(".") &&
    !/[. ]$/.test(stem) &&
    !reserved.test(stem)
  );
}
