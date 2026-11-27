import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Job, Sheet } from "../core/job";
import { postJob } from "../core/postprocessor";
import { parseSimulation, simulationAt } from "../core/gcode-simulation";
import { LengthInput, useDisplayUnits } from "./display-units";
import { SettingsScope, useGlobalDefault } from "./SettingDefaults";
const duration = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
export function GcodeSimulator({
  job,
  sheet,
  onClose,
}: {
  job: Job;
  sheet: Sheet;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    u = useDisplayUnits();
  const [fitBed, setFitBed] = useState(false);
  const previewSvg = useRef<SVGSVGElement>(null);
  const [camera, setCamera] = useState({ zoom: 1, x: 0, y: 0 });
  const base = fitBed
    ? { x: -10, y: -10, width: 480, height: 325 }
    : {
        x: sheet.wcs.x - 5,
        y: sheet.wcs.y - 5,
        width: sheet.stock.width + 10,
        height: sheet.stock.height + 10,
      };
  const view = {
    x: base.x + camera.x,
    y: base.y + camera.y,
    width: base.width / camera.zoom,
    height: base.height / camera.zoom,
  };
  const rapidDefault = Number(useGlobalDefault("simulation.rapidFeed", 3000)),
    speedDefault = Number(useGlobalDefault("simulation.playbackSpeed", 1));
  const [rapid, setRapid] = useState(rapidDefault > 0 ? rapidDefault : 3000),
    [speed, setSpeed] = useState(
      [1, 5, 10, 25, 100].includes(speedDefault) ? speedDefault : 1,
    ),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(true);
  const result = useMemo(() => {
    try {
      const file = postJob(job, sheet.id)[0];
      return {
        file,
        simulation: parseSimulation(file.content, rapid),
        error: "",
      };
    } catch (e) {
      return { file: null, simulation: null, error: (e as Error).message };
    }
  }, [job, sheet.id, rapid]);
  const simulation = result.simulation,
    at = simulation ? simulationAt(simulation, time) : null;
  useEffect(() => {
    const svg = previewSvg.current;
    if (!svg) return;
    const wheel = (e: WheelEvent) => {
      if (!e.deltaY) return;
      e.preventDefault();
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      const anchor = new DOMPoint(e.clientX, e.clientY).matrixTransform(
        matrix.inverse(),
      );
      const [x, y, width, height] = svg
        .getAttribute("viewBox")!
        .split(/\s+/)
        .map(Number);
      const fx = (anchor.x - x) / width,
        fy = (anchor.y - y) / height;
      setCamera((current) => {
        const zoom = Math.max(
            0.25,
            Math.min(200, current.zoom * (e.deltaY > 0 ? 1 / 1.1 : 1.1)),
          ),
          ratio = 1 - current.zoom / zoom;
        return {
          zoom,
          x: current.x + ((fx * base.width) / current.zoom) * ratio,
          y: current.y + ((fy * base.height) / current.zoom) * ratio,
        };
      });
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => svg.removeEventListener("wheel", wheel);
  }, [!!simulation, base.x, base.y, base.width, base.height]);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    if (!playing || !simulation) return;
    let frame = 0,
      last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(1, (now - last) / 1000);
      last = now;
      setTime((t) => Math.min(simulation.seconds, t + dt * speed));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, simulation, speed]);
  useEffect(() => {
    if (simulation && time >= simulation.seconds) setPlaying(false);
  }, [time, simulation]);
  const path = (kind: "cut" | "rapid", completed: boolean) =>
    simulation?.events
      .filter(
        (event, i) =>
          event.kind === kind && (completed ? i < (at?.index ?? 0) : true),
      )
      .map((e) => `M${e.from.x},${e.from.y}L${e.to.x},${e.to.y}`)
      .join(" ");
  const fullCutPath = useMemo(() => path("cut", false), [simulation]);
  const doneCutPath = useMemo(() => path("cut", true), [simulation, at?.index]);
  const doneRapidPath = useMemo(
    () => path("rapid", true),
    [simulation, at?.index],
  );
  return createPortal(
    <dialog
      ref={dialog}
      className="gcode-simulator"
      aria-label={`Simulate ${sheet.name}`}
      onCancel={onClose}
    >
      <header>
        <h2>Simulate · {sheet.name}</h2>
        <button onClick={onClose}>Close simulation</button>
      </header>
      {result.error ? (
        <div role="alert">
          <h3>Cannot simulate posted G-code</h3>
          <p style={{ whiteSpace: "pre-line" }}>{result.error}</p>
        </div>
      ) : (
        simulation &&
        at && (
          <>
            <SettingsScope
              title="Simulation defaults"
              prefix="simulation."
              values={{ rapidFeed: rapid, playbackSpeed: speed }}
              fallbacks={{ rapidFeed: 3000, playbackSpeed: 1 }}
              onRevert={(key, v) => {
                if (key === "playbackSpeed") setSpeed(v);
                else {
                  setRapid(v);
                  setTime(0);
                  setPlaying(false);
                }
              }}
            >
              <div className="simulation-controls">
                <button
                  onClick={() => {
                    setFitBed((v) => !v);
                    setCamera({ zoom: 1, x: 0, y: 0 });
                  }}
                >
                  {fitBed ? "Fit sheet" : "Show full bed"}
                </button>
                <button onClick={() => setCamera({ zoom: 1, x: 0, y: 0 })}>
                  Reset zoom
                </button>
                <button
                  onClick={() => {
                    if (at.finished) setTime(0);
                    setPlaying((v) => !v);
                  }}
                >
                  {playing ? "Pause" : "Play"}
                </button>
                <button
                  onClick={() => {
                    setPlaying(false);
                    setTime(0);
                  }}
                >
                  Restart
                </button>
                <button
                  disabled={at.finished}
                  onClick={() => {
                    setPlaying(false);
                    setTime(
                      Math.min(simulation.seconds, at.event.end + 0.000001),
                    );
                  }}
                >
                  Step command
                </button>
                <label>
                  Playback speed
                  <select
                    aria-label="Simulation playback speed"
                    data-default-key="playbackSpeed"
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value))}
                  >
                    {[1, 5, 10, 25, 100].map((v) => (
                      <option key={v} value={v}>
                        {v}×
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Rapid travel · {u.unit}/min
                  <LengthInput
                    aria-label="Simulation rapid feed" rate
                    data-default-key="rapidFeed"
                    value={rapid}
                    min={1}
                    max={100000}
                    onChange={(v) => {
                      setRapid(v);
                      setTime(0);
                      setPlaying(false);
                    }}
                  />
                </label>
              </div>
            </SettingsScope>
            <input
              aria-label="Simulation progress"
              type="range"
              min={0}
              max={simulation.seconds}
              step={0.01}
              value={time}
              onChange={(e) => {
                setPlaying(false);
                setTime(Number(e.target.value));
              }}
            />
            <p role="status">
              {duration(time)} / {duration(simulation.seconds)} ·{" "}
              {at.finished
                ? "Complete"
                : at.event.kind === "pierce"
                  ? "Piercing"
                  : at.event.kind === "cut"
                    ? "Cutting"
                    : at.event.kind === "rapid"
                      ? "Rapid travel"
                      : "Dwell"}{" "}
              · Line {at.event.line + 1} · X {u.length(at.position.x)} · Y{" "}
              {u.length(at.position.y)} · Water {at.event.water ? "on" : "off"}{" "}
              · Abrasive {at.event.abrasive ? "on" : "off"}
            </p>
            <div className="simulation-view">
              <svg
                ref={previewSvg}
                viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
                aria-label="G-code simulation preview"
              >
                <rect
                  width="460"
                  height="305"
                  fill="#10191e"
                  stroke="#67818a"
                />
                <rect
                  x={sheet.wcs.x}
                  y={sheet.wcs.y}
                  width={sheet.stock.width}
                  height={sheet.stock.height}
                  fill="#223236"
                  stroke="#91aca9"
                />
                <path
                  vectorEffect="non-scaling-stroke"
                  d={fullCutPath}
                  fill="none"
                  stroke="#53676b"
                  strokeWidth=".35"
                />
                <path
                  vectorEffect="non-scaling-stroke"
                  d={doneRapidPath}
                  fill="none"
                  stroke="#81a7c5"
                  strokeWidth=".35"
                  strokeDasharray="2 2"
                />
                <path
                  vectorEffect="non-scaling-stroke"
                  d={doneCutPath}
                  fill="none"
                  stroke="#8bdbab"
                  strokeWidth=".8"
                />
                {(at.event.kind === "cut" || at.event.kind === "rapid") && (
                  <line
                    vectorEffect="non-scaling-stroke"
                    x1={at.event.from.x}
                    y1={at.event.from.y}
                    x2={at.position.x}
                    y2={at.position.y}
                    stroke={at.event.kind === "cut" ? "#8bdbab" : "#81a7c5"}
                    strokeWidth=".8"
                  />
                )}
                <circle
                  cx={at.position.x}
                  cy={at.position.y}
                  r={(at.event.kind === "pierce" ? 2.8 : 1.5) / camera.zoom}
                  fill={at.event.water ? "#f5b174" : "#9bbfdf"}
                  stroke="#fff"
                  strokeWidth={0.5 / camera.zoom}
                />
              </svg>
              <pre aria-label="Current G-code commands">
                {simulation.lines
                  .slice(Math.max(0, at.event.line - 4), at.event.line + 7)
                  .map((line, i) => {
                    const n = Math.max(0, at.event.line - 4) + i;
                    return (
                      <div
                        key={n}
                        className={n === at.event.line ? "active" : ""}
                      >
                        {String(n + 1).padStart(5, " ")} {line}
                      </div>
                    );
                  })}
              </pre>
            </div>
            <p className="micro">
              Plays the exact G-code generated for this sheet, including feed
              changes, pierce dwell and valve shutdown waits. Rapid travel uses
              the rate above; acceleration and controller delays are not
              modeled. No commands are sent to the machine.
            </p>
            <details>
              <summary>Generated G-code · {result.file?.filename}</summary>
              <textarea
                aria-label="Generated simulation G-code"
                readOnly
                value={result.file?.content}
                rows={12}
              />
            </details>
          </>
        )
      )}
    </dialog>,
    document.body,
  );
}
