# Functional parity and development plan

The 0.2 alpha adds jobs, reusable parts and quantities, multiple sheets with X/Y WCS origins, editable material defaults, manual contour tabs and entry positions, pierce footprint warnings, and SVGnest polygon placement. No claim of full WAM compatibility is made.

| Capability | Current state | Next work |
| --- | --- | --- |
| Offline Windows app | Electron runtime; installer and portable builds; manual GitHub update menu | Real two-version release upgrade validation, native file dialogs, recent files, multiple document tabs, recoverable autosaves, signed installer |
| Desktop / Pro | Selectable profiles, common bed envelope | Verified per-model material libraries, firmware-specific postprocessors |
| SVG | Physical units, curves, transforms, shapes, holes | More permissive safe definitions/use support, per-object grouping, explicit tolerance settings |
| DXF | Lines, straight/bulged 2D polylines, arcs, circles; automatic bulge flattening at 0.08 mm tolerance | Ellipses, splines, INSERT transforms, layer mapping, broader units |
| Geometry repair | Degenerate contour checks | Endpoint stitching, duplicate-line detection, self-intersection handling, gap healing with a repair report |
| Vector editing | Shapes, polylines, transforms, node dragging, part clipboard, mouse rotation and on-part duplicate/delete | Multi-select, group/split, alignment, mirroring, dimension locks, Bézier handles, boolean union/difference, join/break |
| Nesting | SVGnest placement worker with no-fit polygons, MaxRects fast candidate, quantities, multiple sheets and cancellable UI worker | Full genetic search, nesting in holes, locked parts, grain constraints, remnants and irregular stock |
| Compensation | Closed-path Clipper offsets and per-contour overrides | Containment tree, minimum feature checks, offset topology review |
| Tabs | Automatic tabs or manual per-contour positions and widths | Corner avoidance, process-specific lift behavior |
| Leads | Straight tangent previews, manual contour entry position | Scrap-side collision-free entry/exit and arc leads |
| Order | Holes first then area | Full containment graph, travel optimization constrained by support, per-operation ordering, manual reorder |
| Material library | 449 Pro reference records, editable defaults database with import/export, per-part process snapshots; 34 tab outliers blocked | Verified arbitrary-thickness calculation (interpolation failed holdouts), Desktop captures |
| Preflight | Bounds/open contour/shape overlap, pierce footprint, quantities, material and WCS checks | Lead collisions, fixture avoidance, fully validated machine envelope, unsupported parameter errors |
| Simulation | Cut/rapid/tab overlay and scrubber | Distance/time-based motion playback, pierce/dwell visualization, postprocessed NC parsing and comparison |
| Export | Project JSON and SVG layout | Validated WAZER cut files, export report and regression fixtures |
| MCP | 21 file-based stdio tools for jobs, sheets, parts, materials and legacy projects | Live editor session synchronization, conflict handling, operation history, cancellable jobs and richer resource/tool discovery |

## Next release: geometry correctness and irregular nesting

1. Implement an import repair pipeline and reviewable diagnostics. Preserve contour identity and source layers.
2. Add locked placements to the version 2 job schema. Quantities and version 1 migration are implemented.
3. Extend the shared nesting provider's bounded search with progress reporting and reproducible optimization seeds. UI cancellation and worker execution are implemented.
4. Extend the integrated [SVGnest](https://github.com/Jack000/SVGnest) placement worker with broader optimization. Our adapter uses no-fit polygons and bounded rotation attempts; it does not include the upstream genetic optimizer. Keep compound geometry and process metadata together.
5. Compare with [libnest2d](https://github.com/tamasmeszaros/libnest2d) if native performance becomes necessary. It is C++ and LGPL-3.0, so distribution/linking choices need explicit review. It is not included in 0.1.
6. Validate exact kerf/lead envelopes after nesting, independent of the optimizer's placement result. Do not permit common-line cutting until its effect on support and compensation is defined.

## WAZER postprocessor validation

**Material status:** [449 Pro reference records across 24 materials](fixtures/wam-reference/materials/README.md) preserve 4,939 numerical values. The 246 independent points reject the diagnostic interpolation baseline. Exact recorded lookup is tested; universal thickness parity, executable Eco behavior, and Desktop values remain unverified. Thin-material tab outliers require explicit handling before preset integration.

**Reference-capture status:** five WAM 2.5.0 Pro jobs and their editable workspaces are available in `fixtures/wam-reference/pro/`, with comparisons in [the test results](fixtures/wam-reference/RESULTS.md). Desktop remains pending because the account lists only a registered Pro machine. Curved leads, kerf-aware tab gaps, tabs on holes, variable feed and timing remain explicit implementation gaps. The existing source files below are still needed for Desktop and for additional modes/firmware coverage.

Machine-ready export is the main missing requirement for practical WAM replacement. Build this as a distinct adapter from preview paths, with fixtures for both machine models.

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
