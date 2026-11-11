# WAM reference capture inputs

The three SVGs in this folder are original synthetic test inputs. The `pro/` folder now contains **unmodified WAM-generated output and editable workspaces**, captured through the built-in browser on 2026-11-08. Chrome control failed, but the built-in browser worked after the owner signed in. See [RESULTS.md](RESULTS.md) for the comparison and limitations.

Capture this matrix for each machine profile available in WAM (Desktop and Pro), using the same named material, thickness and quality where supported. Record all actual settings rather than assuming the two profiles share feed or pierce parameters.

| Case | Source | Cut side | Tabs | Leads | Purpose |
| --- | --- | --- | --- | --- | --- |
| Square centerline | square.svg | Centerline | None | Disabled | Units, axes, origin, feed, start/finish commands |
| Square compensated | square.svg | Outside | None | Disabled | Kerf displacement and winding |
| Square with support | square.svg | Outside | Auto | Enabled | Tab, pierce and lead command sequence |
| Plate with hole | plate-with-hole.svg | Outside | Auto | Enabled | Hole compensation, containment and ordering |
| Open path | open-centerline.svg | Centerline | None | Disabled | Open contour behavior and travel |

For each job:

1. Import the source and confirm its physical dimensions: square 50 × 50 mm; plate 60 × 40 mm with a 20 mm diameter hole; open path 50 × 20 mm with a 70 mm total line length.
2. Position its design bounding box at X=20 mm, Y=20 mm if WAM permits numeric placement; otherwise record the actual position and origin convention explicitly.
3. Select the machine, named material, thickness and quality. Record cut feed, pierce time, kerf, tab width/count/locations and lead settings when visible.
4. Inspect the preview, export the generated machine file, and retain a screenshot of the final settings. Use names identifying the machine and case.
5. Keep exported files unmodified as regression references. Record the WAM version/date and machine firmware version when known.

Import/render success alone does not validate machine behavior. Compare the exported commands and reconstructed toolpaths with the shared local engine before enabling a WAZER postprocessor. No physical cutting is required for this reference-capture step.
