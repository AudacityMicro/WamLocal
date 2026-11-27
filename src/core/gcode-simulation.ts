import type { Point } from "./model";
export type SimulationEvent = {
  line: number;
  from: Point;
  to: Point;
  start: number;
  end: number;
  kind: "rapid" | "cut" | "pierce" | "dwell";
  water: boolean;
  abrasive: boolean;
  feed: number;
};
/** Read-only interpreter for our posted G90/G21/G0/G1/G4 + valve dialect. */
export function parseSimulation(source: string, rapidFeed = 3000) {
  if (!Number.isFinite(rapidFeed) || rapidFeed <= 0)
    throw Error("Simulation rapid feed must be positive.");
  let position: Point = { x: 0, y: 0 },
    feed = 0,
    time = 0,
    absolute = false,
    metric = false,
    water = false,
    abrasive = false,
    hasCut = false,
    hasPierced = false;
  const events: SimulationEvent[] = [],
    lines = source.split(/\r?\n/);
  const metadata = new Set([
    "M1403",
    "M1404",
    "M1405",
    "M1406",
    "M1407",
    "M1410",
    "M1411",
    "M1412",
    "M1413",
  ]);
  for (let line = 0; line < lines.length; line++) {
    const raw = lines[line].split(";")[0].trim();
    if (!raw) continue;
    const code = raw.match(/^[GM]\d+/)?.[0];
    if (!code) throw Error(`Unsupported G-code at line ${line + 1}.`);
    const value = (letter: string) => {
      const match = raw.match(
        new RegExp(
          `(?:^|\\s)${letter}(-?(?:\\d+(?:\\.\\d*)?|\\.\\d+))(?=\\s|$)`,
        ),
      );
      return match ? Number(match[1]) : undefined;
    };
    if (code === "G90") absolute = true;
    else if (code === "G21") metric = true;
    else if (code === "M3") {
      water = true;
      hasCut = false;
      hasPierced = false;
    } else if (code === "M5") water = false;
    else if (code === "M8") abrasive = true;
    else if (code === "M9") abrasive = false;
    else if (code === "G0" || code === "G1") {
      if (!absolute || !metric)
        throw Error(
          `Simulation requires G90/G21 before motion (line ${line + 1}).`,
        );
      feed = value("F") ?? feed;
      const to = {
        x: value("X") ?? position.x,
        y: value("Y") === undefined ? position.y : -value("Y")!,
      };
      const distance = Math.hypot(to.x - position.x, to.y - position.y),
        rate = code === "G0" ? rapidFeed : feed;
      if (distance > 0 && rate <= 0)
        throw Error(`Missing feed at line ${line + 1}.`);
      if (code === "G0" && (water || abrasive))
        throw Error(`Rapid travel with a valve on at line ${line + 1}.`);
      if (code === "G1" && (!water || !abrasive))
        throw Error(`Cutting motion with a valve off at line ${line + 1}.`);
      const end = time + (distance > 0 ? (distance / rate) * 60 : 0);
      events.push({
        line,
        from: position,
        to,
        start: time,
        end,
        kind: code === "G0" ? "rapid" : "cut",
        water,
        abrasive,
        feed: rate,
      });
      time = end;
      position = to;
      if (code === "G1") hasCut = true;
    } else if (code === "G4") {
      const seconds = value("S");
      if (seconds === undefined || seconds < 0)
        throw Error(`Invalid dwell at line ${line + 1}.`);
      events.push({
        line,
        from: position,
        to: position,
        start: time,
        end: time + seconds,
        kind: water && abrasive && !hasCut && !hasPierced ? "pierce" : "dwell",
        water,
        abrasive,
        feed: 0,
      });
      time += seconds;
      if (water && abrasive) hasPierced = true;
    } else if (!metadata.has(code))
      throw Error(`Unsupported ${code} at line ${line + 1}.`);
    if (events.length > 500000)
      throw Error("G-code exceeds simulation event limit.");
  }
  if (water || abrasive) throw Error("G-code ends with a valve on.");
  if (!events.length) throw Error("No motion or dwell commands to simulate.");
  return { events, lines, seconds: time, rapidFeed };
}
export type Simulation = ReturnType<typeof parseSimulation>;
export function simulationAt(simulation: Simulation, seconds: number) {
  const t = Math.max(0, Math.min(simulation.seconds, seconds));
  let low = 0,
    high = simulation.events.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (simulation.events[mid].end <= t) low = mid + 1;
    else high = mid;
  }
  const event = simulation.events[low],
    fraction =
      event.end > event.start
        ? Math.max(
            0,
            Math.min(1, (t - event.start) / (event.end - event.start)),
          )
        : 1;
  return {
    index: low,
    event,
    position: {
      x: event.from.x + (event.to.x - event.from.x) * fraction,
      y: event.from.y + (event.to.y - event.from.y) * fraction,
    },
    finished: t >= simulation.seconds,
    fraction,
  };
}
