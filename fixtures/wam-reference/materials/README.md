# WAM material reference checks

Captured through the signed-in WAM 2.5.0 browser UI on 2026-11-08, using the account's registered **Pro** machine. These are reference measurements, not a claim of complete machine compatibility.

## Results

- All 24 standard materials: **449 thickness points**, including each displayed maximum and thin, intermediate, and common fractional stock sizes.
- **4,939 numerical fields** checked against the original workspace exports, with no mismatches. Each capture contains three quality feeds plus abrasive rate for each recorded mode, pierce time, default tab width, and default lead distance.
- 203 initial points and **246 independent validation points**. The independent points were excluded from the diagnostic interpolation fit.
- Exact recorded values are available through `lookupRecordedMaterial` in `src/core/material-reference.ts`. The editor and MCP use a compact Speed Mode preset library generated from these captures. It includes three quality feeds, pierce time, abrasive rate and tab/lead defaults. Thirty-four records exceed the editor's 20 mm tab limit and cannot be applied; 415 thickness records are applicable. Presets retain the job's kerf and tab count. Uncaptured thicknesses require custom parameters; no interpolation is used.
- **Arbitrary-thickness reproduction is not verified.** A log-log interpolation baseline fails the independent checks; its largest pierce-time relative error is approximately 398% for stainless steel 304. This rejects that baseline, not every possible numerical model. Experimental curve fits are also not production settings generators.
- Desktop values remain untested: the account exposes only a registered Pro machine. Pro values must not be reused as Desktop values.

See [coverage by material](COVERAGE.md) and [per-field validation results](validation-report.json).

## Thickness and mode scope

The thickness control advertises a 0.001-inch step, but also accepts finer values, including 0.0625 and 0.1875 inches. A complete grid at the displayed step would therefore still not establish parity at every accepted thickness. The 0.001-inch sample is the smallest positive point tested, not a verified physical cutting minimum. The input's declared minimum is zero; zero is not accepted by the local lookup.

Above-maximum entry was attempted for every material. At the immediate UI observation, each value was either clamped to the maximum or marked invalid by the input. These observations do not establish identical asynchronous clamping behavior across materials or validate backend rejection. Raw observations are in [upper-bound-checks.json](upper-bound-checks.json).

The workspace contains both `speedMode` and `ecoMode` fields. The recorded Eco rates are constant across these captures; Eco execution and mode switching were not independently tested. Presence in the workspace does not prove equivalent executable Eco behavior.

## Outliers and remaining work

Nine captured default tab widths exceed the 460 mm bed width; the largest is 2,684,341.03 mm for 0.001-inch granite. These values are preserved as WAM observations, not approved cutting presets. They must not be applied blindly or used to relax the editor's parameter validation.

To claim exact reproduction for every supported thickness, obtain the calculation definitions and coefficients, or develop an independent model and validate its rounding, limits, transitions, and units against substantially broader holdouts. WAM's material changes were observed making a `calculateMaterialValues` service request; ordinary workspace exports contain the evaluated values, not enough information to establish the complete calculation. Desktop requires separate captures and validation. Machine-ready export remains disabled.

## Evidence and rerunning

- `captures/*.wzr`: original downloaded workspace bytes.
- `samples.json`: extracted material records; `training-samples.json`: frozen initial set.
- `capture-hashes.json`: SHA-256 hashes of every raw capture.
- `../material-limits.json`: categories, names and displayed limits.
- `validation-report.json`: integrity, holdout errors and outliers.

From the repository root:

```powershell
npx tsx scripts/analyze-materials.ts
npm test
```

The analyzer checks aggregate fields against raw exports and regenerates coverage, hashes and diagnostic errors. The regression suite checks exact lookup coverage and rejects unsupported combinations; passing it does not establish a universal material formula or physical cut quality.

No vendor code is included in the implementation. A public browser asset was inspected during reference work to locate the material calculation boundary; its code was not copied. The reference data comes from normal workspace exports.
