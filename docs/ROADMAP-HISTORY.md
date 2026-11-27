# Archived development plan

This snapshot predates the 1.0 release; see ROADMAP.md for current status.

# Functional parity and development plan

Version 0.11 adds scoped setting-default context menus, three-level editable material organization, a cleaned preset interface and read-only playback of generated G-code including motion, pierces and valve waits. Cost defaults are filled for legacy profiles; customized values are preserved.

Version 0.10 consolidates material, stock dimensions, spacing, sheet origin and automatic tab rules on Jobs. All parts and sheets share the job setup. Hole/part area thresholds use square display units, and editable thickness-based tab defaults replace WAM tab-width defaults. Remnants navigation is removed; remnant inventory is deferred.

The 0.3 alpha adds jobs, reusable parts and quantities, multiple sheets with X/Y WCS origins, editable material defaults, manual contour tabs and entry positions, pierce footprint warnings, and SVGnest polygon placement. No claim of full WAM compatibility is made.

| Capability | Current state | Next work |
| --- | --- | --- |
| Windows app | Electron runtime; installer and portable builds; manual GitHub update menu; native job Open/Save/Save As and unsaved-change prompts | Real two-version release upgrade validation, recent files, multiple document tabs, recoverable autosaves, signed installer |
| Desktop / Pro | Selectable profiles, common bed envelope | Verified per-model material libraries, firmware-specific postprocessors |
| SVG | Physical units, curves, transforms, shapes, holes, definitions/use/symbols, styles and vector clips; text/image/effect outlining; local assets; configurable 0.01 mm default tolerance | Broader typography fidelity, source-layer preservation, reviewable repair |
| DXF | Lines, polylines, arcs, circles, ellipses, rational/periodic splines, fitted-curve reconstruction, recursive INSERT arrays, text/image outlines, hatch/dimension boundaries; binary/text decoding and standard units; configurable tolerance | External block resolution, opaque solid conversion, source layers and broader real-world fixtures |
| Geometry repair | Degenerate contour checks | Endpoint stitching, duplicate-line detection, self-intersection handling, gap healing with a repair report |
| Vector editing | Shapes, polylines, transforms, node dragging, part clipboard, mouse rotation and on-part duplicate/delete | Multi-select, group/split, alignment, mirroring, dimension locks, Bézier handles, boolean union/difference, join/break |
| Nesting | SVGnest placement worker plus constrained search, rotation steps, locks, grain rules, optional hole nesting, saved layouts, quantities, multiple sheets and cancellable UI worker | Full genetic search, remnant inventory and offcut editing (placeholder only) |
| Compensation | Closed-path Clipper offsets and per-contour overrides | Containment tree, minimum feature checks, offset topology review |
| Tabs | Shared job width/count, minimum hole area and maximum net part area in mm²/in²; decreasing thickness-based starting widths; manual contour overrides; shared preview/posting rules | Corner avoidance, physical validation of starting widths, process-specific lift behavior |
| Leads | Scrap-side tangent arcs or straight entries, length limiting, manual entry, other-part collision checks | Fixture-aware entry optimization |
| Order | Holes first then area | Full containment graph, travel optimization constrained by support, per-operation ordering, manual reorder |
| Material library | 560 full Pro references plus 1,700 both-machine feed captures; all supported common sizes in three qualities; bounded custom estimates; 34 tab outliers flagged | Full Desktop pierce/lead captures, physical validation of custom estimates |
| Preflight | Bounds/open contour/shape overlap, pierce footprint, quantities, material and WCS checks | Lead collisions, fixture avoidance, fully validated machine envelope, unsupported parameter errors |
| Simulation | Exact generated G-code parsed into timed travel/cutting/dwell events; highlighted commands, seeking, stepping and playback speed; valve/pierce states; sheet/bed fit | Calibrated machine rapid rates, acceleration and controller delay models |
| Export | Project JSON, SVG, per-sheet and batch WAZER G-code, geometric corner slowdown, preflight and output reports | Physical machine validation, broader firmware captures, calibrated process scheduling |
| MCP | 23 file-based stdio tools for jobs, sheets, parts, materials and legacy projects | Live editor session synchronization, conflict handling, operation history, cancellable jobs and richer resource/tool discovery |

## Version 0.6 workspace and nesting

Jobs now combines parts, nesting options, and interactive sheet previews. Advanced search controls live in Nesting Settings. Searches use fresh seeds, 1-90 degree rotation steps, contact-first constrained placement and same-sheet continuation after timed-out batches. Automatic gauge dimensions cover 7-26 including odd gauges. Empty default stock can adopt the requested material; explicit stock assignments remain fixed.

## Next release: geometry correctness and irregular nesting

1. Implement an import repair pipeline and reviewable diagnostics. Preserve contour identity and source layers.
2. Locked placements, quantities and version 1 migration are implemented. Add a dedicated remnant inventory after the placeholder workflow is designed.
3. Extend the shared nesting provider's bounded search with progress reporting and reproducible optimization seeds. UI cancellation and worker execution are implemented.
4. Extend the integrated [SVGnest](https://github.com/Jack000/SVGnest) placement worker with broader optimization. Our adapter uses no-fit polygons and bounded rotation attempts; it does not include the upstream genetic optimizer. Keep compound geometry and process metadata together.
5. Compare with [libnest2d](https://github.com/tamasmeszaros/libnest2d) if native performance becomes necessary. It is C++ and LGPL-3.0, so distribution/linking choices need explicit review. It is not included in 0.1.
6. Validate exact kerf/lead envelopes after nesting, independent of the optimizer's placement result. Do not permit common-line cutting until its effect on support and compensation is defined.

## WAZER postprocessor validation

**Material status:** [560 Pro reference records across 24 materials](fixtures/wam-reference/materials/README.md) preserve 6,160 numerical values. The 357 independent points reject the diagnostic interpolation baseline. Exact recorded lookup is tested. Added 1,700 feed-only records across both catalogs and bounded custom estimates; see [both-machine coverage](fixtures/wam-reference/materials/BOTH-MACHINES.md). Universal thickness parity, executable Eco behavior and Desktop pierce/lead values remain unverified. Thin-material tab outliers require explicit handling before preset integration.

**Reference-capture status:** five WAM 2.5.0 Pro jobs and their editable workspaces are available in `fixtures/wam-reference/pro/`, with comparisons in [the test results](fixtures/wam-reference/RESULTS.md). The demo supplies common-size feeds for both machines, but disables job/workspace exports. Full Desktop pierce/lead references remain pending. Curved leads, kerf-aware tabs, tabs on holes and variable feed are implemented and compared; physical validation is still required. The existing source files below are still needed for Desktop and for additional modes/firmware coverage.

Independent WAZER posting is implemented in 0.7. The remaining release gate is physical cut and firmware-specific validation. Posted files share the compensated, tab-split operation plan with the preview.

Required reference inputs from the owner:

- A small WAM-generated output file for each target machine and firmware version, with the corresponding SVG/DXF, material, thickness, quality, tabs and lead settings.
- Fixtures for a single square, a plate with a hole, an open centerline, multiple parts, tabs, and leads; include expected units/origin and cutting order.
- Confirmation of the supported controller/firmware, file header/footer requirements, feed conventions, dwell units, pump/abrasive/nozzle commands and machine limits, through public documentation or manufacturer support.

Implementation sequence:

1. Parse the reference files into a documented command model. Keep vendor-specific commands out of the generic geometry planner.
2. Generate deterministic files and compare them to reference behavior, including pump/abrasive sequencing, tabs, leads, dwell and safe start/finish states.
3. Round-trip generated files through an independent parser and verify units, origin, bounds, internal-before-external order, process state and duration estimates.
4. Have the owner perform supervised manufacturer-supported validation before designating a profile as verified. Keep unverified profiles clearly marked.

## Design direction

Keep an original, dense desktop workbench rather than a step-by-step browser wizard: a large bed view, direct geometry manipulation, numeric properties, keyboard commands, parts list, and visible preflight. Advanced controls should be available without hiding the geometry. Avoid UI state that differs from MCP state by placing all operations and validation rules in the shared application/core layer.

## 0.4 settings update

Implemented machine kerf/abrasive/travel limits with embedded job snapshots, signed per-side stock allowance, dynamic pierce fallback, contour selection by preview click, individual lead overrides, dependent material/thickness/quality selectors, nine sheet-origin anchors, persistent display units/file-label visibility, and contextual workspace controls. WAZER posting is implemented in 0.7; physical cut and firmware-specific verification remain outstanding.

## 0.5 nesting update

Implemented batch job packing, complexity-based automatic time allocation with improvement-driven extensions, fixed shared limits, best-layout retention on budget expiration, progress and stop/keep controls, saved effort/method/order/objective/detail/pass/seed policies, sheet limits, preservation of existing placements, per-part process clearance, and consistent boundaries across SVGnest and constrained passes. Hole ordering, geometry validation and locks remain shared with the CAM model. Full optimal nesting and guaranteed-fit proofs remain outside this bounded heuristic search.
