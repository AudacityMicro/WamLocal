import { inspectReferenceNc } from "./nc-inspect";
import { distance } from "./geometry";

/** Independent read-only process-state audit. Never executes machine commands. */
export function auditNc(source: string) {
  const geometry = inspectReferenceNc(source);
  let water = false, abrasive = false, initialized = false, ended = false, cut = false;
  const errors: string[] = [], pierceDwells: number[] = [], counts: Record<string, number> = {};
  const known = new Set(["G90", "G21", "G0", "G1", "G4", "M1403", "M1404", "M1405", "M1406", "M1407", "M1410", "M1411", "M1412", "M1413", "M3", "M5", "M8", "M9"]);
  let lineNumber = 0;
  for (const raw of source.split(/\r?\n/)) {
    lineNumber++;
    const line = raw.split(";")[0].trim(); if (!line) continue;
    const code = line.match(/^[GM]\d+/)?.[0]; if (!code) { errors.push(`Line ${lineNumber}: unparsed command`); continue; }
    counts[code] = (counts[code] ?? 0) + 1;
    const error = (message: string) => errors.push(`Line ${lineNumber}: ${message}`);
    if (!known.has(code)) error(`unknown command ${code}`);
    if (ended) error("command after shutdown");
    if (code === "M1403") initialized = true;
    if (code === "M3") { if (!initialized) error("water enabled before initialization"); if (water) error("water enabled twice"); water = true; cut = false; }
    if (code === "M8") { if (!water) error("abrasive enabled without water"); abrasive = true; }
    if (code === "M9") abrasive = false;
    if (code === "M5") { if (abrasive) error("water shut off before abrasive"); water = false; }
    if (code === "G0" && (water || abrasive)) error("rapid motion with jet or abrasive enabled");
    if (code === "G1") { if (!water || !abrasive) error("linear cut without water and abrasive"); cut = true; }
    if ((code === "G0" || code === "G1") && !initialized) error("motion before initialization");
    if (code === "G4" && water && abrasive && !cut) pierceDwells.push(Number(line.match(/\bS([\d.]+)/)?.[1] ?? 0));
    if (code === "M1404") { if (water || abrasive) error("shutdown with valves enabled"); ended = true; }
  }
  if (!ended) errors.push("Missing WAZER shutdown");
  if (!geometry.moves.some((m) => !m.rapid && distance(m.from, m.to) > 1e-8)) errors.push("No cutting motion");
  const feeds = geometry.moves.filter((m) => !m.rapid && distance(m.from, m.to) > 1e-8).map((m) => m.feed);
  return { ...geometry, counts, errors, pierceDwells, feedMinimum: Math.min(...feeds), feedMaximum: Math.max(...feeds), feedLevels: [...new Set(feeds)].sort((a, b) => a - b), zeroLengthLinearMoves: geometry.moves.filter((m) => !m.rapid && distance(m.from, m.to) <= 1e-8).length };
}
