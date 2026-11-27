import type { Part } from "../core/model";
import { selectStepFace } from "../core/step-import";
import { useDisplayUnits } from "./display-units";

export function StepFaceSelector({
  part,
  onChange,
}: {
  part: Part;
  onChange: (part: Part) => void;
}) {
  const u = useDisplayUnits(),
    source = part.stepSource;
  if (!source) return null;
  const selected = source.faces.find((f) => f.id === source.selected);
  return (
    <section>
      <h3>STEP CUTTING FACE</h3>
      <label className="field">
        <span>Cutting face</span>
        <select
          aria-label="STEP cutting face"
          value={source.selected}
          onChange={(e) => onChange(selectStepFace(part, e.target.value))}
        >
          {[...source.faces]
            .sort((a, b) => b.area - a.area)
            .map((f) => (
              <option key={f.id} value={f.id}>
                {f.label} · {Number(u.toDisplayArea(f.area).toFixed(3))}{" "}
                {u.areaUnit} · {f.holes} openings
              </option>
            ))}
        </select>
      </label>
      <p className="micro">
        Changing the face replaces the edited geometry, tabs and entry points.
        Face openings can include blind pockets; check the intended through-cuts
        before posting.
      </p>
      {!!selected?.blindHoles && (
        <p className="warning">
          {selected.blindHoles} opening(s) may be blind or obstructed. Cutting
          these outlines will cut through the stock.
        </p>
      )}
      {source.bodyCount > 1 && (
        <p className="warning">
          This model contains {source.bodyCount} bodies. Only the selected face
          is imported. Import the file again to cut a face from another body.
        </p>
      )}
    </section>
  );
}
