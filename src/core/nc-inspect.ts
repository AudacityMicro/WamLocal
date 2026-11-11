import { bounds, distance } from "./geometry";
import type { Point } from "./model";

/** Read-only inspector for the G90/G21/G0/G1 subset observed in captured WAM files.
 * Coordinates are normalized to the editor's Y-down system. This does not
 * interpret vendor M-codes as machine-control instructions or emit G-code.
 */
export function inspectReferenceNc(source: string) {
  let cursor: Point = { x: 0, y: 0 },
    feed = 0,
    segment = -1,
    dwellSeconds = 0;
  let absolute = false,
    millimetres = false;
  const moves: {
    from: Point;
    to: Point;
    rapid: boolean;
    feed: number;
    segment: number;
  }[] = [];
  const mCodes: string[] = [],
    unsupportedCodes: string[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.split(";")[0].trim();
    if (!line) continue;
    const code = line.match(/^[GM]\d+/)?.[0];
    if (!code) continue;
    const n = (letter: string) => {
      const match = line.match(
        new RegExp(`(?:^|\\s)${letter}(-?\\d+(?:\\.\\d*)?)`),
      );
      return match ? Number(match[1]) : undefined;
    };
    if (code === "G90") absolute = true;
    else if (code === "G21") millimetres = true;
    else if (code === "G4") dwellSeconds += n("S") ?? 0;
    else if (code === "G0" || code === "G1") {
      if (!absolute || !millimetres)
        throw Error("Reference inspector requires G90 and G21 before motion.");
      if (code === "G0") segment++;
      feed = n("F") ?? feed;
      const to = {
        x: n("X") ?? cursor.x,
        y: n("Y") === undefined ? cursor.y : -n("Y")!,
      };
      if (code === "G1" && distance(cursor, to) > 1e-8 && feed <= 0)
        throw Error("Linear move has no positive feed.");
      moves.push({ from: cursor, to, rapid: code === "G0", feed, segment });
      cursor = to;
    } else if (code.startsWith("M")) mCodes.push(code);
    else unsupportedCodes.push(code);
  }
  const linear = moves.filter((m) => !m.rapid);
  const endpoints = linear.flatMap((m) => [m.from, m.to]);
  const declaredTime = source.match(/^M1413 (\d+):(\d+):(\d+)/m);
  return {
    moves,
    cutLength: linear.reduce((s, m) => s + distance(m.from, m.to), 0),
    linearSeconds: linear.reduce(
      (s, m) => s + (m.feed > 0 ? (60 * distance(m.from, m.to)) / m.feed : 0),
      0,
    ),
    dwellSeconds,
    bounds: endpoints.length ? bounds(endpoints) : null,
    segments: new Set(linear.map((m) => m.segment)).size,
    mCodes,
    unsupportedCodes,
    declaredSeconds: declaredTime
      ? Number(declaredTime[1]) * 3600 +
        Number(declaredTime[2]) * 60 +
        Number(declaredTime[3])
      : null,
  };
}
