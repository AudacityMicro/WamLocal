# WAM reference test results

Captured on 2026-11-08 through WAM's normal browser UI, version **2.5.0**. Five valid Pro cases were exported as both `.gcode` and `.wzr`. The plate-with-hole case was also run in WAM's simulation. Original downloaded bytes are retained under `pro/`. No vendor source code was copied. Subsequent material investigation included inspecting a public browser asset to locate the calculation boundary; see the [material report](materials/README.md).

## Scope and settings

- Machine: **WAZER Pro**. The account's machine selector listed only one registered Pro machine. **Desktop remains untested**, not assumed equivalent. No machine registration or account settings were changed.
- Material: Aluminum - 6061; thickness entered as **0.11811 in** (2.999994 mm); medium quality; speed mode in captured workspaces.
- Feed: **131.22 mm/min**; pierce dwell: **6.93 s**; account nozzle/kerf setting: **0.038 in / 0.9652 mm**. These are values from this reference session, not universal machine defaults or a new production preset.
- Design bounding-box origin: approximately **20 × 20 mm**. WAM's inch UI rounded placement by about 0.00004 mm. Source physical dimensions were verified in WAM's position panel.
- Default tab width: **1.35 mm**, one automatic tab per closed contour when enabled. Default lead setting: **0.92 mm**, with curved lead geometry in the exported workspace.
- WAM emits absolute, millimetre motion (`G90`, `G21`) with negative machine Y. The analysis normalizes Y to the editor's positive-down coordinates.

## Comparison

Local previews were reconstructed from equivalent primitive contours and the **actual saved WAM settings**, rather than the alpha's example defaults. Placement is reconstructed from the workspace's `RSTBB.originalMinX/Y` and instance position; WAM's internal placement origin is not always the bounding-box centre, and `RSTBB.minX/Y` include compensation. The comparison does not retest the SVG importer or establish physical cutting accuracy.

| Pro case | WAM commanded G1 distance | Local preview cut distance | WAM declared time | Local estimate |
| --- | ---: | ---: | ---: | ---: |
| Square, centerline, no tabs/leads | 200.000 mm | 200.000 mm | 117 s | 98.38 s |
| Square, outside, no tabs/leads | 203.184 mm | 202.953 mm | 104 s | 99.73 s |
| Square, outside, automatic tabs/leads | 201.790 mm | 202.523 mm | 107 s | 99.53 s |
| Plate with hole, outside, automatic tabs/leads | 260.182 mm | 263.230 mm | 153 s | 134.22 s |
| Open centerline, no tabs/leads | 70.000 mm | 70.000 mm | 47 s | 38.94 s |

The WAM distance column counts exported `G1` motion, including leads. Local distance excludes tab gaps. These are comparable measures, but differing lead, tab and offset geometry explains some differences. WAM's declared time is not a measurement of physical runtime; a separate sum of emitted feed motion and `G4` dwell also differs from its declared estimate. See [comparison.json](comparison.json) for raw metrics.

Verified geometric invariants:

- Centerline square and open path match the intended dimensions, location, and 200 / 70 mm line lengths.
- Outside square extents match within **0.01 mm**: WAM width 50.9600 mm; local width 50.9652 mm. Export quantization accounts for the extent difference. Their corner tessellation and total lengths are not identical.
- WAM's plate output has two motion segments and cuts the internal hole before the external profile. The local planner's existing hole-first behavior is separately covered by its geometry tests.
- All five valid references contain nonempty metric absolute motion and the observed start/end markers.

## Differences requiring implementation work

1. **Leads:** WAM stores curved entry and exit paths; the alpha previews a straight entry tangent and does not have equivalent lead-out or scrap-side placement. Envelopes and cut lengths differ.
2. **Tab gaps:** WAM applies automatic tabs to both closed contours in the plate, including the hole. The local planner applies tabs only to outer contours. In these workspaces, WAM's compensated tab path gap is approximately **2.3152 mm** for a nominal 1.35 mm tab: the gap includes the 0.9652 mm kerf. The local gap currently uses the nominal width directly.
3. **Feeds and time:** WAM varies feed near corners and endpoints, emits additional dwell commands and vendor-specific metadata/process commands. The alpha uses uniform feed plus pierce time and underestimates these captured jobs. No semantics for vendor M-codes have been certified from these captures alone.
4. **Offset detail:** Compensation extents agree closely, but rounded corner approximation and start-point selection differ.
5. **Desktop:** No Desktop reference was available from this account. Its material parameters, emitted format and model-specific behavior still need capture.

These observations are a regression baseline, **not a machine-ready postprocessor validation**. Machine output remains disabled in the local app; no physical machine was operated.

## WAM state issue found during testing

After replacing the first fixture, WAM retained an old material summary while the current file's material/cutting-order state was not initialized. The first plate export contained headers and a zero duration but **no cutting motion**. It is retained under `diagnostics/plate-uninitialized-material.gcode`, excluded from the five valid cases, and covered by an empty-output detection test. Re-selecting material and changing thickness to trigger recalculation produced the valid plate export.

For later imports, verify both populated material controls and a nonempty cut order, then inspect the downloaded motion rather than relying on a previously displayed summary.

## Reproduce the analysis

```powershell
npx tsx scripts/analyze-wam-reference.ts
npm test
```

`src/core/nc-inspect.ts` is a read-only inspector for the limited absolute metric linear-motion subset observed here, not a general NC interpreter or machine driver. It records vendor M-code names without interpreting or executing them. `scripts/analyze-wam-reference.ts` reconstructs the equivalent local jobs and writes the JSON comparison. Ten new reference checks supplement the existing ten geometry tests; passing checks cover the stated invariants, not full path/time equivalence.

Evidence: [plate simulation](../../artifacts/wam-pro-plate-simulation.png), [final open-path export](../../artifacts/wam-pro-open-reference.png). Source G-code and workspaces are in [pro/](pro/).
