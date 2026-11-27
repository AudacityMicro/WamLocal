# CAM refinements: 0.7.1

November 16, 2026. Compared with the same eleven Pro WAM 2.5.0 captures used for the [0.7.0 baseline](../posting-0.7.0/RESULTS.md).

## Corrected behavior

- Tab widths now specify the intended finished bridge. Automatic and manual path gaps include one full kerf width, including wrapped manual tabs and centerline cuts. Automatic tabs apply to holes as well as outer profiles. A contour can still explicitly disable tabs.
- WAM gap totals and cutting-operation counts now match for all four tabbed reference cases. A nominal 1.35 mm tab produces a 2.3152 mm gap with 0.9652 mm kerf; the thin aluminum case produces 9.8052 mm per tab. Exact tab locations remain our own algorithm.
- Tangent quarter-circle leads replace straight normal entries by default. Requested lead length is arc length. Their chords stay in the contour's scrap; intersection checks detect narrow boundary crossings, and arcs shorten where necessary. Degenerate or unsuitable entries retain the normal-entry fallback. Every lead chord participates in neighboring-part and stock checks. Tangency at an original polygon vertex follows the adjacent scrap-side edge; arbitrary sharp corners cannot have both incoming and outgoing tangency.
- Corner feeds now slow according to turning angle and distance from a turn. The observed Pro right-angle reference supplies a 45% corner factor with recovery of 20 percentage points per 5 mm. Smooth, sufficiently broad curves retain nominal feed. Actual emitted moves, preview, cut-time and abrasive estimates share this schedule.
- Cuts & tabs exposes **Lead shape: Tangent arc / Straight** and **Slow down at corners**. Overrides are embedded in the job and used by the MCP server too. Missing fields in older jobs select the new defaults. No stored preset feed or pierce value is overwritten.

## Where matching WAM would reduce precision

Round offset joins now have a 0.001 mm chord tolerance instead of 0.03 mm. Compensation remains a physical offset after rotation and scaling. Independent checks at six rotations confirm the requested 0.4826 mm distance from the original profile, within integer-coordinate rounding, and analytic rotated-rectangle bounds within 0.005 mm.

For the 30-degree, 75%-scale rectangle, analytic outside width is approximately **54.93634 mm**. Local output is **54.9361 mm**, while WAM outputs **55.01 mm**. We retain our closer geometric result rather than inflate the offset to reproduce WAM's larger bound. This is evidence about this geometry, not proof of superior physical cuts.

## Remaining differences and limits

The corner policy is a documented independent approximation, not WAM's proprietary feed model. It may be slower than WAM in some cases and faster in others. For example, the centerline square's programmed linear-plus-dwell time is 126.40 seconds locally versus WAM's 122.62; the thin medium plate is 43.84 versus 45.92. These calculations exclude rapid travel and controller acceleration and are not measured runtimes. Straight leads and constant feed remain selectable for comparison or a tuned process.

Leads, tab placement, curve discretization and corner scheduling are not byte-for-byte equivalent to WAM. Actual physical bridge widths also depend on calibrated kerf and lead geometry, particularly near corners or on curved profiles. No physical cuts or paired Desktop reference captures were performed. The slowdown is based on Pro evidence; Desktop cut quality still needs validation.

## Validation

- 215 automated tests pass, including independent command-state replay, all eleven paired WAM references, hole and outer tab totals, manual seam gaps, arc scrap containment for both windings and both directions, tiny-hole lead limiting, physical offsets at six rotations, right-angle feed scheduling, and preservation of explicit straight/constant options.
- All eleven paired outputs pass the command-state audit and retain the captured nominal maximum feeds and pierce dwells.
- TypeScript/build checks pass. Source and packaged MCP smoke tests pass, including sheet and batch posting.
- Browser-tested controls change the process and persist the chosen overrides in a saved WAM document. Screenshot: `../../../artifacts/cam-refinement-0.7.1.png`.
- Run `npx tsx scripts/compare-wam-posting.ts` to regenerate the machine-readable `comparison.json` and paired paths in this folder. The prior 0.7.0 baseline is preserved.
