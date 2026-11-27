# Generated STEP fixtures

These synthetic fixtures were generated for Wam Local using Open CASCADE via the development-only Python `cadquery-ocp` package. Python/OCP is not required by Wam Local.

- `drilled-plate.step`: 100 × 60 × 3 mm plate, two through-holes (radii 5 and 8 mm).
- `rotated-plate.step`: same plate rotated 0.7 radians about the (1,1,0) axis.
- `blind-pocket.step`: 100 × 60 × 3 mm plate with one 8 mm radius blind pocket from z=1 to z=3.
- `sphere.step`: 10 mm radius sphere; must reject without a planar face.
- `inch-plate.step`: 25.4 × 12.7 × 3.175 mm plate written with STEP inch units.
- `two-bodies.step`: compound with 80 × 50 × 3 mm and 20 × 15 × 2 mm boxes.

All cutting geometry tests use the real bundled reader, including triangulation, unit conversion and original BRep face ranges.
