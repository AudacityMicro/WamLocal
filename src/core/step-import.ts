import { makePart, type Contour, type Part, type Point } from "./model";
import { classifyImportedContours } from "./import-contours";
import { importTolerance } from "./import-settings";
import { pointInPaths } from "./path-math";

export type Vec3 = [number, number, number];
export interface StepMesh {
  name: string;
  attributes: { position: { array: number[] }; normal?: { array: number[] } };
  index: { array: number[] };
  brep_faces: { first: number; last: number }[];
}
export interface StepResult {
  success: boolean;
  meshes?: StepMesh[];
}
const sub = (a: Vec3, b: Vec3): Vec3 => a.map((v, i) => v - b[i]) as Vec3;
const dot = (a: Vec3, b: Vec3) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (v: Vec3): Vec3 => v.map((x) => x / Math.hypot(...v)) as Vec3;
const area = (p: Point[]) =>
  Math.abs(
    p.reduce((s, a, i) => {
      const b = p[(i + 1) % p.length];
      return s + a.x * b.y - b.x * a.y;
    }, 0) / 2,
  );

// Work on each original BRep face, never on a silhouette of the entire solid:
// a silhouette can silently erase openings or create cuts through hidden features.
export function extractStepFaces(result: StepResult, toleranceMm = 0.01) {
  importTolerance(toleranceMm);
  if (!result.success || !result.meshes?.length)
    throw Error(
      "STEP could not be read, or contains no solid/surface geometry.",
    );
  const candidates: NonNullable<Part["stepSource"]>["faces"] = [];
  for (const [bodyIndex, mesh] of result.meshes.entries()) {
    const xyz = mesh.attributes.position.array,
      indices = mesh.index.array;
    if (indices.length > 3_000_000)
      throw Error(
        "STEP tessellation is too large. Increase the import curve tolerance or simplify the model.",
      );
    const vertex = (i: number): Vec3 => [
      xyz[i * 3],
      xyz[i * 3 + 1],
      xyz[i * 3 + 2],
    ];
    for (const [faceIndex, face] of mesh.brep_faces.entries()) {
      if (face.first > face.last) continue;
      const triangles: Vec3[][] = [];
      let normal: Vec3 | undefined, origin: Vec3 | undefined;
      for (let t = face.first; t <= face.last; t++) {
        const tri = indices.slice(t * 3, t * 3 + 3).map(vertex);
        if (
          tri.length !== 3 ||
          tri.some((v) => v.some((x) => !Number.isFinite(x)))
        )
          throw Error("STEP contains invalid face coordinates.");
        const n = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]));
        if (Math.hypot(...n) < 1e-12) continue;
        if (!normal) {
          normal = unit(n);
          origin = tri[0];
        }
        triangles.push(tri);
      }
      if (!normal || !origin) continue;
      const n = normal,
        o = origin;
      // Tight planarity check independent of the curve tessellation tolerance.
      // A coarsely meshed curved face must not be mistaken for a flat cutting face.
      const planeEpsilon = 1e-5;
      if (
        triangles.some((tri) =>
          tri.some((p) => Math.abs(dot(sub(p, o), n)) > planeEpsilon),
        )
      )
        continue;
      const normals = mesh.attributes.normal?.array;
      if (
        normals &&
        indices.slice(face.first * 3, (face.last + 1) * 3).some((i) => {
          const nn: Vec3 = [
            normals[i * 3],
            normals[i * 3 + 1],
            normals[i * 3 + 2],
          ];
          return Math.hypot(...nn) > 0 && Math.abs(dot(unit(nn), n)) < 0.999999;
        })
      )
        continue;
      // Prefer the global X axis in the face plane, then global Y for vertical faces.
      const axis: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const u = unit(sub(axis, n.map((v) => v * dot(axis, n)) as Vec3)),
        v = cross(n, u);
      const project = (p: Vec3): Point => ({
        x: dot(sub(p, o), u),
        y: -dot(sub(p, o), v),
      });
      const points: Point[] = [],
        keys = new Map<string, number>();
      // OCCT duplicates seam vertices. Weld only below the CAD accuracy threshold.
      const weld = 1e-6;
      const pointId = (p: Vec3) => {
        const q = project(p),
          key = `${Math.round(q.x / weld)},${Math.round(q.y / weld)}`;
        let id = keys.get(key);
        if (id === undefined) {
          id = points.length;
          keys.set(key, id);
          points.push(q);
        }
        return id;
      };
      const edges = new Map<string, { a: number; b: number; count: number }>();
      for (const tri of triangles) {
        const ids = tri.map(pointId);
        for (let i = 0; i < 3; i++) {
          const a = ids[i],
            b = ids[(i + 1) % 3];
          if (a === b) continue;
          const key = a < b ? `${a}:${b}` : `${b}:${a}`,
            e = edges.get(key);
          if (e) e.count++;
          else edges.set(key, { a, b, count: 1 });
        }
      }
      const boundary = [...edges.values()].filter((e) => e.count === 1),
        links = new Map<number, number[]>();
      for (const { a, b } of boundary) {
        links.set(a, [...(links.get(a) ?? []), b]);
        links.set(b, [...(links.get(b) ?? []), a]);
      }
      // Non-manifold/open face boundaries are unsafe to turn into closed profiles.
      if (!boundary.length || [...links.values()].some((l) => l.length !== 2))
        continue;
      const used = new Set<number>(),
        contours: Contour[] = [];
      for (const start of links.keys()) {
        if (used.has(start)) continue;
        const loop: Point[] = [];
        let current = start,
          previous = -1;
        do {
          if (used.has(current)) break;
          used.add(current);
          loop.push(points[current]);
          const next = links.get(current)!.find((i) => i !== previous)!;
          previous = current;
          current = next;
        } while (current !== start && loop.length <= boundary.length);
        if (current !== start || loop.length < 3) {
          contours.length = 0;
          break;
        }
        if (loop.length > 20000)
          throw Error(
            "STEP face exceeds 20,000 points per contour. Increase the import curve tolerance.",
          );
        if (area(loop) > 1e-8)
          contours.push({ points: loop, closed: true, hole: false });
      }
      if (!contours.length) continue;
      const classified = classifyImportedContours(contours);
      if (classified.length > 1000)
        throw Error("STEP face exceeds 1,000 contours.");
      const minX = points.reduce((m, p) => Math.min(m, p.x), Infinity),
        minY = points.reduce((m, p) => Math.min(m, p.y), Infinity);
      const normalized = classified.map((c) => ({
        ...c,
        points: c.points.map((p) => ({ x: p.x - minX, y: p.y - minY })),
      }));
      const outerArea = classified
        .filter((c) => !c.hole)
        .reduce((s, c) => s + area(c.points), 0);
      const holeContours = classified.filter((c) => c.hole);
      let blindHoles = 0;
      for (const hole of holeContours) {
        const p = hole.points,
          xs = p.map((p) => p.x),
          ys = p.map((p) => p.y);
        const loX = Math.min(...xs),
          hiX = Math.max(...xs),
          loY = Math.min(...ys),
          hiY = Math.max(...ys);
        // Test several interior rays, avoiding the tessellated boundary itself.
        const samples: Point[] = [];
        for (let x = 1; x <= 5; x++)
          for (let y = 1; y <= 5; y++) {
            const q = {
              x: loX + ((hiX - loX) * x) / 6,
              y: loY + ((hiY - loY) * y) / 6,
            };
            if (pointInPaths([p], q)) samples.push(q);
          }
        const blocked = samples.some((q) => {
          for (let t = 0; t < indices.length; t += 3) {
            const tri = indices
              .slice(t, t + 3)
              .map(vertex)
              .map(project);
            if (area(tri) < 1e-10) continue;
            if (pointInPaths([tri], q)) return true;
          }
          return false;
        });
        // An unsampleably narrow opening is conservatively treated as uncertain.
        if (blocked || !samples.length) blindHoles++;
      }
      candidates.push({
        id: `${bodyIndex}:${faceIndex}`,
        body: mesh.name || `Body ${bodyIndex + 1}`,
        label: `Body ${bodyIndex + 1} · Face ${faceIndex + 1}`,
        area: outerArea,
        holes: holeContours.length,
        blindHoles,
        normal: n,
        contours: normalized,
      });
    }
  }
  if (!candidates.length)
    throw Error(
      "No closed planar STEP face could be extracted. Curved surfaces must be flattened in CAD before cutting.",
    );
  // Features break near-area ties, without choosing a tiny perforated side wall.
  const maxArea = Math.max(...candidates.map((f) => f.area));
  const score = (f: (typeof candidates)[number]) =>
    f.area *
    (1 +
      Math.min(f.holes - f.blindHoles, 10) * 0.02 -
      Math.min(f.blindHoles, 10) * 0.03);
  const eligible = candidates.filter((f) => f.area >= maxArea * 0.8);
  eligible.sort(
    (a, b) =>
      score(b) - score(a) ||
      b.normal[2] - a.normal[2] ||
      a.id.localeCompare(b.id),
  );
  const chosen = eligible[0];
  // Keep every alternative in the WAM file, so face selection survives save/reopen.
  return {
    selected: chosen.id,
    faces: candidates,
    bodyCount: result.meshes.length,
    toleranceMm,
  };
}

export function stepPart(
  name: string,
  result: StepResult,
  toleranceMm = 0.01,
  faceId?: string,
): Part {
  const source = extractStepFaces(result, toleranceMm);
  if (faceId !== undefined) {
    if (!source.faces.some((f) => f.id === faceId))
      throw Error(`STEP face ${faceId} does not exist or is not planar.`);
    source.selected = faceId;
  }
  const chosen = source.faces.find((f) => f.id === source.selected)!;
  return { ...makePart(name, chosen.contours), stepSource: source };
}

export function selectStepFace(part: Part, faceId: string): Part {
  const source = part.stepSource,
    face = source?.faces.find((f) => f.id === faceId);
  if (!source || !face) throw Error("STEP face is unavailable.");
  return {
    ...part,
    contours: face.contours.map((c) => ({
      ...c,
      points: c.points.map((p) => ({ ...p })),
    })),
    stepSource: { ...source, selected: faceId },
  };
}
