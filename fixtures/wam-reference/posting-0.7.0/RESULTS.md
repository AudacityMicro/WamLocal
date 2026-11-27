# Wam Local 0.7.0 versus WAM 2.5.0

Compared on November 16, 2026. Eleven paired Pro outputs were inspected: five saved November 8 references and six fresh WAM browser exports. This compares the actual `postJob` output, including split tab spans, pierces and lead-outs. The older parent-directory report compares legacy preview paths and is historical.

## Findings

1. **Tab width needs correction.** With nominal tab width 1.35 mm and kerf 0.9652 mm, WAM leaves a 2.3152 mm path gap. Local leaves 1.35 mm. On a straight edge, subtracting kerf gives an approximate physical bridge of 0.3848 mm instead of 1.35 mm. This is a geometric estimate, not a measured cut. Fresh 0.020-inch captures confirm the same rule: WAM's nominal 8.84 mm tabs have 9.8052 mm path gaps; local gaps are 8.84 mm each. Tab locations also differ.
2. **Automatic hole tabs are missing locally.** WAM's automatic tab count applies to the hole and outside profile in these examples. Local applies its defaults to outside profiles only. The fresh two-tab examples therefore have four WAM cutting operations versus three local operations.
3. **Corner feed scheduling differs.** WAM varies feed along a profile and slows near corners. Local uses the selected nominal feed throughout. Nominal maximum feeds and pierce dwells match in all eleven pairs, but this does not reproduce WAM's cutting process. Shorter programmed times below should not be interpreted as a performance improvement.
4. **Lead and compensated path geometry differ.** WAM exports curved leads; local uses straight scrap-side leads. Offset joins and curve discretization also differ. The unrotated square's compensated width differs by 0.0052 mm; the rotated/scaled example's powered-path bounding width and height differ by about 0.1285 and 0.1289 mm. These are bounds differences, not maximum pointwise error. Leads are included in bounds where enabled.
5. **Command sequencing passes the bounded audit.** Both files in all eleven pairs initialize, use millimetres and absolute coordinates, turn water on before abrasive, avoid powered rapids, and turn abrasive off before water and shutdown. The audit found no errors in its supported command subset. This does not establish firmware acceptance or physical cut quality.

## Paired results

Time is the sum of commanded linear distance/feed plus explicit dwells, excluding rapid travel time and acceleration. It is not measured runtime or the on-screen estimate. Length includes all powered G1 movement, including leads.

| Case | Settings | WAM G1 length mm | Local mm | WAM programmed s | Local s |
| --- | --- | ---: | ---: | ---: | ---: |
| sq-centerline | 3 mm, medium, centerline | 200.000 | 200.000 | 122.62 | 101.38 |
| sq-outside | 3 mm, medium, outside | 203.184 | 202.953 | 110.17 | 102.73 |
| sq-tabs-leads | 3 mm, medium, one tab + leads | 201.790 | 203.443 | 110.35 | 102.95 |
| plate-hole-valid | 3 mm, medium, hole + outside, tabs + leads | 260.182 | 265.070 | 158.47 | 141.06 |
| open-centerline | 3 mm, medium, open path | 70.000 | 70.000 | 52.93 | 41.94 |
| cmp020c | 0.020 in, coarse, centerline | 262.819 | 262.740 | 41.75 | 34.48 |
| cmp020m | 0.020 in, medium, centerline | 262.819 | 262.740 | 45.92 | 37.73 |
| cmp020f | 0.020 in, fine, centerline | 262.819 | 262.740 | 51.27 | 41.92 |
| cmp020t | 0.020 in, fine, outside, two tabs + leads | 226.641 | 249.290 | 50.96 | 44.42 |
| cmp020i | 0.020 in, medium, inside, two tabs, no leads | 222.768 | 244.226 | 50.27 | 39.88 |
| cmp020r | 0.020 in, medium, outside, rotation 30 degrees, scale 75% | 197.286 | 196.965 | 34.08 | 30.40 |

All materials above are Aluminum 6061. The saved baseline thickness is 0.11811 inches (approximately 3 mm). Fresh nominal feeds are coarse 605, medium 537.78 and fine 470.55 mm/min; pierce dwell is 1.21 seconds. Baseline nominal feed is 131.22 mm/min and pierce is 6.93 seconds. Kerf is 0.9652 mm throughout.

Fresh centerline outputs have the same 60 x 40 mm outer bounds at X20/Y20. The 0.079 mm total path-length difference comes from different circular discretization. Exact bounds do not mean identical toolpaths.

## Reproduction and evidence

- Run `npx tsx scripts/compare-wam-posting.ts` from the repository root to regenerate `comparison.json`, local jobs, actual posted NC and normalized path JSON.
- Run `npm test` for command-state fault injection and paired reference checks. The passing checks establish specific invariants, not WAM equivalence; known divergences remain documented above.
- Raw WAM exports and workspaces are in `../pro/` and `../fresh-2026-11-16/`. SHA-256 hashes of paired NC files are recorded in `comparison.json`.
- Fresh geometry was uploaded through the real app's SVG importer and saved as `../fresh-2026-11-16/local-svg-import.wam`. Its contours are reused for the fresh comparisons. WAM's saved placement, rotation, scale, quality, mode, tab and lead settings drive the reconstructed local jobs. WAM's raw saved settings take precedence over an intended UI setting: `cmp020i` contains two automatic tabs, not zero.
- Original geometry is centered on its source bounds before applying WAM's saved instance transform. Controller Y is normalized to positive-down for comparison.

## Limits and next work

No production behavior was changed by this test work. Fix the tab kerf allowance and automatic hole-tab behavior before relying on these defaults for a cut. Next, investigate WAM's corner feed scheduling and compensated joins, and expand shape coverage to concave profiles and narrow holes.

These cases use one part and do not compare nesting quality. They cover one material at two thicknesses, three qualities for the thin sample, and one Pro account configuration. They do not validate the full material database, Desktop geometry/process parity, all WAM options, controller firmware acceptance or physical cutting. Desktop command tests elsewhere in the suite are not a substitute for a paired Desktop WAM capture.
