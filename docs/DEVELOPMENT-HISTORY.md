# Development history before 1.0

These archived notes describe earlier builds; see the current README for installation and supported behavior.

# Wam Local


## STEP import and job tabs (0.18.0)

Import `.step` and `.stp` files using **Upload parts**. OpenCascade runs in a background worker and converts file units to millimetres. Face selection favors large planar faces with accessible through-openings; suspected blind pockets reduce the score. The part editor's **Geometry → STEP cutting face** selector offers the other planar faces. Alternatives are embedded in the WAM file and survive reopening. Changing faces replaces edited contours, tabs and entry points. Curved surfaces are rejected rather than flattened. Multi-body files import one selected face; import again and choose another body to obtain another part. Review blind or obstructed openings before posting. Import curve tolerance also controls STEP tessellation (default 0.01 mm).

**New Job** and **Open Job** open job tabs. Each tab keeps its own document, path, undo/redo history, material snapshot and workspace. Presets, display units and machine defaults remain application-wide. Use Ctrl+N, Ctrl+O, Ctrl+Tab / Ctrl+Shift+Tab and Ctrl+W. Closing a tab or the application protects unsaved jobs, including inactive tabs. Tabs cannot switch during an active nesting or posting operation.

The empty Parts section includes **Upload parts**. Quantity **0** retains a definition while removing its placed copies and excluding it from nesting/posting.

**WCS reference** switches the nine-point origin picker between the sheet and the combined outline bounding box of all placed parts on each sheet. Parts bounds follow placement rotation/scale and exclude kerf, leads and stock allowance. Empty sheets use sheet bounds until parts are placed. The reference changes displayed work coordinates and the origin marker; posted WAZER coordinates retain the existing absolute machine-bed convention.

**Lead-in overlap** and **Lead-out overlap** extend closed-profile cutting before and after the nominal entry point, with material defaults and contour overrides. Both default to zero. The posted preview, G-code, time and abrasive estimates use the same extended path. Overlap stops at retaining tabs and does not apply to open contours or pierce-only holes.

Generated filenames keep descriptive names, sanitize forbidden characters and reserved Windows names, and replace every period in the stem with an underscore. Only the final extension retains its period: `6061 .020 rev.2` becomes `6061 _020 rev_2.gcode`. Uploaded source files are not renamed.

Verification: `npm test -- --maxWorkers=2`, `npm run build`, and `npx tsx scripts/verify-step.ts`. The latter exercises the actual Chromium/worker/WASM pipeline through MCP on both machines. See `licenses/STEP-reader-notice.md` for CAD reader licenses and corresponding source.

## Version 0.17 editor controls and cut filenames

Delete/Backspace on a selected tab removes that tab, converting automatic tabs on the contour into explicit remaining tabs. Deletion is undoable and does not remove the part. Keyboard focus stays in the tab layer after deletion so a held/repeated Delete cannot fall through to part deletion.

The simulation preview supports cursor-anchored wheel zoom up to 200× during playback. Reset zoom restores the current fit; switching sheet/bed fit also resets zoom. Toolpath strokes and the moving head marker stay readable when zoomed.

Cut filenames now default to the job name (`Mounting plate.gcode`). Multi-sheet jobs use stable sheet numbers (`Mounting plate - Sheet 2.gcode`), including individual sheet posting. Filesystem-invalid characters are sanitized and unusually long names shortened; the single-sheet Save dialog still permits a custom name. Descriptive filenames support spaces and Unicode. Output path, reserved-device, duplicate-name and overwrite checks remain in place.

## Version 0.16 contour cleanup, small holes and detail zoom

Imports and saved-job loading merge coincident paths within a part, including reversed lines, collinear subdivisions and closed paths with different starting vertices/winding. Duplicate source contours are removed before hole classification. Manual contour roles on nonduplicate geometry remain unchanged. Separate sheet copies/parts are never merged as common-line cuts.

Small holes with a compensated maximum span no greater than twice the requested lead length pierce at their area centroid and enter/exit radially. Concave openings whose centroid is outside use a visible interior point; nested retained islands prevent unsafe center entry. Zero lead length still disables ordinary lead-ins. Holes completely removed by inward kerf compensation instead receive a **pierce-only** operation at a safe centroid/interior point, with no perimeter movement. Configured pierce time, abrasive, shutdown overhead, estimates and simulation still apply. Footprint warnings remain when the resulting pierce can exceed the intended hole size.

The part editor supports up to 200× wheel/button zoom. Wheel zoom anchors the point under the cursor and prevents page scrolling over the preview. The supplied `Shim.dxf` regression fixture imports as one outside profile and five holes; its two smallest holes become pierce-only operations at the default kerf, giving six operations with no duplicate cuts.

## Version 0.15.1 startup performance

Gauge and material-reference lookups now use indexes rather than repeatedly scanning the full catalog. Desktop startup reads and upgrades its authoritative database once, without first expanding a browser-storage mirror or expanding the IPC result again. Loading no longer rewrites an unchanged 5 MB database. Edits still persist normally, and a failed load can be retried without overwriting presets.

`npx tsx scripts/benchmark-startup.ts` compares the previous packaged catalog loader with the optimized code against one disposable copy of the same saved database and asserts identical results. On the development machine, the 7,285-profile catalog read/upgrade median fell from 1,226 ms to 149 ms (8.2×). This measures catalog work, not total application launch time. See `artifacts/startup-comparison-0.15.1.json`.

## Version 0.15 MCP workbench

The MCP server exposes 48 tools covering saved-job workflows, including SVG/DXF/raster imports, drawing and node editing, contour roles/kerf/tabs/lead-ins, part process overrides, quantities, copy/delete, placement transforms/locks, stock and sheet origins, material presets, machine costs, defaults, SVG/toolpath export, simulation, and posting.

| Editor workflow | MCP tools |
| --- | --- |
| Open, save, Save As, naming | `list_workspace`, `create_job`, `read_job`, `write_job`, `save_job_as`, `configure_job` |
| Upload drawings or images | `import_parts` (relative paths or inline UTF-8/base64; same Chromium import pipeline) |
| New part, sketch, nodes, cuts/tabs/lead-ins | `create_part`, `edit_part`, `edit_contour`, `update_job_part` |
| Copy/paste and delete | `duplicate_parts`, `delete_parts`, `edit_placements` |
| Sheet setup and placement | `configure_job`, `add_sheet`, `update_sheet`, `remove_sheet`, `place_part`, `edit_placements` |
| Nest and stop/keep best | `nest_job`, `nest_sheet`, `start_nesting`, `nesting_status`, `stop_nesting` |
| Materials, machine, costs, defaults | `query_material_presets`, `edit_material_preset`, `apply_job_material`, `application_settings`, `setting_default` |
| Preview, toolpaths, simulation, post | `export_job_svg`, `inspect_job`, `simulate_sheet`, `post_sheet`, `post_all` |
| Undo/redo | `job_history` (up to 20 saved-job snapshots per server session) |

Run `npm run build` before using a source server so its Chromium import renderer and background nesting worker exist. Packaged builds include both. Imports preserve originals; linked images/fonts must be beside drawings or embedded. No network resources are fetched. Geometry and process inputs always use millimetres, regardless of display units. `query_material_presets` provides filtered, paginated profiles without returning the complete library.

For long searches use `start_nesting`, poll `nesting_status`, and optionally `stop_nesting` with `keepBest`. Workers keep the server responsive. Completed results/checkpoints are saved only if the job has not changed since search start. Undo likewise rejects external edits. Simulation returns paginated events and the interpolated position/valve state at a time or command step; it uses the actual posted G-code without operating hardware.

MCP operates on saved documents and shared settings. Save GUI work first and reopen externally edited jobs. View selection, zoom, panels and playback presentation are represented through IDs, SVG and simulation queries rather than remote GUI clicks. Installation/updates and physical machine operation are outside the CAM API. Other saved jobs retain their embedded material snapshots when presets change.

`scripts/verify-mcp-workbench.ts` exercises the expanded workflow, real artwork imports and failure handling, simulation, undo/redo, background cancellation and concurrent-edit protection; run it with `WAM_MCP_EXE` to test the packaged executable. The MCP page includes copyable connection configuration and a small both-machine test prompt.

## Version 0.14 job workflow, shared material editing and MCP setup

New jobs default to same-machine 6061 aluminum at 3 mm, medium quality, while explicit saved material defaults still take precedence. New GUI jobs automatically use `YYYY-MM-DD · material · thickness` names in the current display units. The creation date is retained; changing material/thickness updates an automatic name. Entering a name commits a manual name, and the reset icon restores automatic naming. Older saved names and explicit MCP names remain manual.

The Jobs sidebar now contains the name, Upload parts, New part, Post all and Nest job. Reusable-layout save/load controls are removed. Plus/pencil buttons next to job material selection open a modal: new materials receive explicitly entered coarse, medium and fine feeds; edits update the shared preset and active job while preserving tab-rule overrides when unchanged. Other saved jobs retain their embedded material snapshots. User-created stocks do not silently gain unknown machine/gauge profiles.

Presets, Machine and MCP now use the full workspace with responsive multi-column layouts. The MCP page provides desktop-generated executable/script/database paths, copyable client JSON, setup steps, units and file-model guidance, all 24 tools, troubleshooting, and a copyable end-to-end prompt. The server also sends workflow instructions to clients during initialization. `scripts/verify-mcp-guide.ts` exercises the documented five-copy, one-sheet, eight-operation workflow on both machines without operating hardware.

## Version 0.13 part handles and numeric editing

In **Part editor → Cuts & tabs**, drag yellow handles to move tabs, blue circles to move lead-in entries along their contours, and blue squares to change lead-in length. Automatic gaps are converted to manual locations on that contour when dragged, preserving the other locations and widths. Lead-in handles work with no tabs. Each completed drag creates one undo step; Escape or pointer cancellation discards the drag. Handle markers stay small in screen pixels. The static orange cut-head marker and the “Preview parameters” note are removed.

Numeric controls throughout the app preserve partially typed decimals, minus signs, trailing decimal points and zeros. Values such as `.005` and `-.005` are accepted, converted using display units and committed only when valid. Blank or invalid drafts restore the last valid number on blur; optional machine prices can be cleared. Enter finishes editing, Escape restores the starting value and arrow keys retain step controls. Min/max limits and integer-only fields still apply.

## Version 0.12.2 posting without review flags and quieter DXF imports

Material review flags no longer add preview issues, block posting or produce source/estimate warnings in the posting report. The manual review checkbox is removed from Presets. Legacy provenance is retained internally for compatible preset selection and migration; it never changes the numeric cut values or certifies them as measurements. Invalid settings, geometry, machine-model mismatches, bed limits and controller resume-time notices still apply.

Successful DXF spline conversion, block expansion, text/image outlining and construction-marker handling are silent. Failed, unsupported, missing and invalid geometry still produces an import error. Successful imports retain the brief file-count result.

## Version 0.12.1 numeric presets and clean selectors

The numeric audit checks nine effective process fields in every shipping preset and the upgraded local library. Missing legacy abrasive values inherit the machine rate; explicit zero/custom values are preserved. A zero pierce diameter continues to use machine kerf. Quality selectors no longer append “Needs settings” or generic “Custom” status suffixes, and the repeated preset warning paragraph is removed. Multiple variants of one quality are distinguished by actual feed, pierce time and lead length. Existing process verification flags and posting checks remain; numeric completeness does not imply measured process validation.

## Version 0.12 sheet selection and material repairs

- Sheet previews support Ctrl+click toggles, Ctrl+A / Edit → Select All, and directional drag selection from empty space. A rightward orange window requires complete enclosure; a leftward green crossing box selects touching profiles. Crossing tests use the actual transformed geometry and respect empty holes. Ctrl adds a box selection. Selected parts move together, including arrow-key nudges, and support group copy/paste, duplicate and delete. Text fields retain normal editing shortcuts.
- Job material selectors, including quality, share one row. **Tabs & lead-ins** includes job lead-in length and shape independently of tab count or tab mode; contour overrides remain in the part editor. Tab widths follow thickness automatically until manually overridden; the automatic-width checkbox is removed.
- Thirteen coarse-feed capture errors are corrected against fresh visible G-code from both source machines. Original archives remain intact; reviewed overrides have saved evidence. All 492 named-material generic feed placeholders now receive bounded same-machine estimates. Estimated and feed-only profiles retain process review flags.
- Broken Pro EPDM process defaults use same-thickness acrylic settings, with bounded interpolation for custom thicknesses and nearest donor endpoints outside that range. These are explicitly material substitutions requiring review, not validated EPDM settings. Unvalidated constant polyethylene foam rates stay flagged rather than receiving an unrequested substitute.
- Generated local presets migrate on load while user-edited process values and embedded job snapshots remain intact. Remaining source curve anomalies and missing Desktop pierce/lead measurements are not invented or silently approved.

## Version 0.11 defaults, material organization and G-code simulation

- Right-click setting controls or their labels for **Save as default** and **Revert to default**. Process values, tab rules, stock allowance and contour defaults are stored in the matching material/machine/thickness/quality record, including when a working job uses a copied preset ID. Stock, nesting, import and simulation defaults are application settings; machine defaults are separated by model. Saved settings survive restarts and preset database export/import. Names, geometry coordinates and manual tab locations are document content rather than reusable settings.
- Jobs and Presets select **Family → Class → Material → Thickness → Quality**. Families are Plastic, Metal, Ceramics, Rubbers and Other. Classes and grades derive from existing stock identities; **Presets → Organization** can change the display organization across all profiles of a material without changing its cutting data or stock compatibility. Unclassified materials remain selectable. Capture notes, source labels and the duplicate reference panel are removed from the Presets interface; source data stays internal.
- Each populated sheet has **Simulate**. It generates the same G-code as posting and plays parsed G0/G1 motion, G4 pierce/shutdown dwells and valve states, highlighting the current command. Controls include pause/play, restart, step, speed, seeking and sheet/bed fit. Posting preflight applies. Rapid travel defaults to 3000 mm/min and is editable; acceleration and firmware delays are not modeled. This is a read-only simulation.
- Machine cost defaults use the captured reference values: abrasive $0.53/lb (approximately $1.16845/kg), Desktop running costs $5.22/hour, Pro $6.64/hour, USD. **Use WAZER cost defaults** restores only these cost fields. Missing legacy prices are filled; explicit zero and custom prices remain intact.

Pierce time is the material's `pierce` value in seconds. Captured process presets copy it from the stored reference table; custom-thickness estimates interpolate it between same-machine/material references. Where full process data is absent, the generic starting value is 5 seconds and remains flagged for review. **Part editor → Process → Pierce time** changes the job value, and its context menu can save a material-specific default. The postprocessor emits `G4 S<seconds>` after turning on water and abrasive for every cutting operation, including spans separated by tabs.

## Version 0.10 shared job setup and tab rules

Jobs now has expanded **Material & sheets**, **Tabs**, and **Nesting options** sections. A job uses one material/thickness/quality and one sheet size, margin, spacing and sheet origin for every part and sheet. Changing these settings retains placements; the existing preflight catches any placements outside a resized sheet. Sheet cards retain their name, preview and posting controls. Remnants navigation is removed.

Automatic tab count and finished bridge width are job settings. **Minimum hole area** excludes smaller holes. The optional **Maximum part area** excludes larger parts, measured as enclosed outer area minus holes at placed scale. Boundary equality includes tabs. Areas display in mm² or in² with the display-unit toggle; storage remains mm². Manual contour tabs remain explicit overrides in the graphical part editor. Preview and posting use the same rules.

Default tab widths no longer follow the captured WAM tab-width values. The editable starting rule is `clamp(1.016 × sqrt(0.508 / thicknessMm), 0.254, 1.016)` mm: .040 in at .020 in stock, decreasing to .010 in by .320 in stock. These bounds govern defaults only; custom values outside that range are allowed. This is an application default, not a physically validated material calibration. Generated preset defaults are upgraded while edited widths and embedded job snapshots are preserved.

Opening an older mixed-stock job in the UI adopts its first sheet's material and size for the whole job and reports that conversion. Existing tab widths/counts and manual tab locations are retained. Saving writes the consolidated setup; the original file stays unchanged until saved.

## Version 0.9 artwork imports and configurable tolerance

**View → Import settings**, or **Machine → Vector import settings**, controls curve tolerance for new SVG/DXF imports. The default is **0.01 mm**; the field follows the display-unit toggle. Tolerance, tracing resolution (600 DPI by default) and darkness threshold are saved locally across jobs. Existing imported geometry is unchanged.

SVG text, images, masks and appearance effects can become monochrome cut outlines automatically while ordinary vectors retain their geometry. DXF import adds ellipses, text, image references, hatch boundaries, dimension blocks, flat faces and fitted curves alongside rational/periodic splines and nested blocks. Text and raster conversions report their approximations. Available local or embedded fonts are used; missing fonts can change lettering. Raster detail remains limited by the source image and selected resolution/threshold.

The desktop app embeds referenced image/font files from beside the selected drawing or its subdirectories. Supporting assets can also be selected alongside drawings in a batch. Missing assets, opaque ACIS solids/regions, unsupported 3D geometry and unresolved external blocks receive explicit errors; universal lossless SVG/DXF conversion is not claimed.

Both supplied DXFs import at 0.01 mm. Verification includes 251 passing tests, browser imports and settings persistence, and a packaged Windows test converting SVG text and adjacent SVG/DXF image assets into editable contours. Source and packaged MCP smoke checks pass.

## Version 0.8.2 DXF spline and block imports

DXF import now converts planar SPLINE/NURBS curves to polylines at the existing 0.08 mm physical tolerance, including rational weights and periodic knot vectors. INSERT blocks are expanded recursively with base points, rotation, nonuniform/mirrored scale and row/column arrays preserved. The tolerance accounts for block scaling. Missing/circular block references, unresolved external blocks and unsupported nonplanar or fit-point-only splines produce specific errors instead of silently dropping geometry.

Both supplied drawings were checked through the batch-upload interface: 118 and 17 closed contours respectively. Originals are unchanged. The regression suite now has 242 passing tests, including rational-curve accuracy, S bends, periodic curves and block transforms.

## Version 0.8.1 preset corrections and comparison checks

- Applying a preset keeps placements when the material, thickness and machine are compatible, including changes between cut qualities. Incompatible stock still returns affected copies to the unplaced quantity.
- Deleted presets stay deleted after restarting. Applying a full reference explicitly restores that reference. Deleted IDs travel with exported/imported preset databases.
- **Apply material preset** now applies the reference snapshot to the active part or sheet and saves it to the database. The reference panel describes the available Desktop feeds, missing Desktop process verification and custom-thickness estimates accurately.
- UI smoke scripts now target the empty Jobs workspace, part editor and preset workflows. The regression suite has 235 passing tests; preset fixes were also checked through the browser. A real two-version installer upgrade and physical cuts remain untested.
- Five new Desktop motion captures use identical SVG paths: washer, slotted plate, concave bracket, open path and a tabbed/led plate. Untabbed paths agree within 0.082 mm in the sampled comparison; tab/entry positions and speed schedules differ. The existing 11 full Pro files pass the independent command-state audit. See [fresh comparison data](fixtures/wam-reference/live-2026-11-17/comparison.json), [Pro posted-file comparisons](fixtures/wam-reference/posting-0.8.1/comparison.json), and [overlays](artifacts/wam-comparison-0.8.1.svg). Desktop demo captures do not verify pierce dwell or valve sequencing.

## Version 0.8 material coverage and posting estimates

- Both WAM catalogs are represented: 28 Desktop materials and 24 Pro materials. Every supported common metric, fractional-inch and material-specific gauge size has coarse, medium and fine profiles. The library contains 7,280 records. See [both-machine coverage](fixtures/wam-reference/materials/BOTH-MACHINES.md).
- Added 1,700 thickness captures / 5,100 measured quality feeds, alongside 560 full Pro process references. Missing pierce/lead parameters remain flagged. Demo exports are disabled, so full Desktop process settings remain pending. Upgrades preserve user edits and saved-job snapshots.
- **Machine → Default machine for new jobs** persists locally. **Use this machine for current job** reapplies matching profiles while preserving parts, sheets and placements. Jobs opened from disk retain their embedded machine. Rates are never copied between machines.
- Machine settings include abrasive price, hourly running cost and currency. Posting reports per-sheet and batch cutting time, pierces, abrasive mass and costs. Missing rates show as not configured; zero explicitly excludes a cost. Estimates omit rapid travel/acceleration, setup, sheet changes and stock.
- **Presets → Calculate from WAM references** and MCP `estimate_material_settings` provide bounded same-machine/material interpolation, without extrapolation. Custom estimates require review; pierce transitions are not reliably predicted. Common sizes use measured feeds. See the coverage report for independent feed holdout results.
- Fresh machine defaults use the observed demo kerf of 0.038 in (0.9652 mm), 150 g/min abrasive, and editable reference prices. Existing jobs and settings are preserved.

An independent waterjet design and CAM workbench for power users. Electron + React + TypeScript, with a shared geometry engine and a local MCP server. This is a working **0.11 alpha**, with independent WAZER posting pending physical-machine validation.

![Job setup](artifacts/jobs-inline-sheets.png)

## Version 0.7 posting

Each sheet preview has **Post sheet** and **Post all**, and Jobs has a **Post all** button. The File menu offers the same actions when context permits. Post sheet chooses one .gcode file; Post all chooses a folder and writes a separate file for every populated sheet. Empty sheets are skipped. Post all checks that every requested copy is placed; single-sheet posting can export a partial job. Existing files require replacement confirmation, and a failed batch restores replaced files. Exporting does not operate the machine.

The independent postprocessor emits metric absolute WAZER motion (G90/G21), startup/shutdown metadata, high-pressure and abrasive on/off commands, per-part feed and pierce dwell, and three shutdown dwell seconds per cutting operation. Contours are compensated using the job's machine kerf and stock allowance. Tabs split contours into independent cutting spans: the jet is off for travel between spans, with a new scrap-side lead-in and pierce on each span, and a scrap-side lead-out before stopping. Preview toolpaths and posted operations share that plan. Configured feeds are constant; this does not reproduce WAM's adaptive feed scheduling or curved lead geometry.

Coordinates map sheet placement back to the machine bed, with negative controller Y. The nine-point sheet origin remains a work-coordinate reference and is described in the header; it does not enable unsupported controller work offsets. Cut Extents include the jet footprint. Resume-after-pause uses the sheet's largest pierce time; differing per-part dwell values are reported. Time estimates include pierces and shutdown waits, but exclude rapid travel.

Preflight blocks unverified material profiles, wrong-machine settings, missing geometry, invalid feed, overlaps, bounds, stock-outline/exclusion violations and leads crossing another part. Pierce/stop footprint interference and shortened leads are reported for review. Windows output uses short .gcode filenames and atomic staged batch writes. The browser development build downloads Post all as a ZIP. MCP has matching `post_sheet` and `post_all` tools, with replacement disabled unless explicitly requested.

Protocol evidence: [manufacturer command documentation](https://support.wazer.com/resources/maintenance/wam-procedures/understanding-g-code-on-wazer), the captured WAM 2.5.0 Pro files, and public manufacturer Desktop/Pro welcome-cut files. Source URLs, hashes and control facts are in `fixtures/posting/protocol-sources.json`. The post uses the observed 2.5.0 Pro and 1.4 Desktop dialect metadata, while identifying Wam Local as the generator. Command replay, geometry, file output and UI downloads are tested. **Physical machine cutting and firmware-specific acceptance have not been verified.**

## Version 0.6.2 gauge captures and saved profile selection

The recorded catalog now contains 560 Pro material/thickness records across all 24 materials, including every 7-26 gauge for Aluminum 6061, Stainless 304/316, and Steel 1018/1095/A2. All three quality feeds are captured for each. Of these records, 526 have usable captured tab/lead defaults (1,578 complete quality profiles); 34 retain flagged tab-default outliers. Desktop requires its own captures.

When a saved job contains an older unverified profile, its Quality list now also offers the complete **WAM reference** of the same quality. Choosing that entry, or reselecting the material/thickness, applies the recorded settings. Existing embedded values remain until that explicit choice. Quality menus in jobs and part editors filter to the active machine; the presets database can still show both machines.

## Version 0.7.1 CAM refinements

Tabs now use finished bridge widths, with kerf added to the uncut path gap, and automatic defaults apply to holes too. **Cuts & tabs** offers tangent arc or straight leads and a corner slowdown switch. Arcs stay on the scrap side and shorten where space is limited. Corner scheduling uses the captured Pro right-angle behavior as an independent approximation; it is not full WAM process parity. Older jobs without these new fields use arc leads and corner slowdown by default. Preview, posting, time estimates and MCP share the same posted plan.

Round compensation uses a 0.001 mm chord tolerance and preserves physical offsets after scaling and rotation. The analytic geometry checks justify retaining our offset instead of matching WAM's slightly inflated rotated bound. See the [0.7.1 comparison results](fixtures/wam-reference/posting-0.7.1/RESULTS.md) for corrected behaviors and remaining differences. Physical cuts and Desktop process parity remain unverified.

## Version 0.6.1 profiles and hole leads

All recorded thicknesses now appear in the global presets database with Coarse, Medium and Fine choices. The first expansion has 450 Pro thickness captures, including a new 0.020-inch Aluminum 6061 capture on 2026-11-16 (605 / 537.78 / 470.55 mm/min and 1.21 seconds pierce). Exact quality feeds are preserved. Records with invalid tab/lead defaults retain the captured process rates but use an explicitly flagged application tab/lead default. Additional common-size profiles use measured same-machine feeds; missing process settings remain flagged. Bounded custom-thickness interpolation is available with review required. Library upgrades preserve edited defaults and embedded jobs.

Closed-profile leads now approach from scrap: inside holes and outside external profiles, independent of winding or placement rotation. Manual entry points are retained. Leads are shortened and reported if they would cross another edge of the same contour. Pierce footprint checks still flag insufficient space. This does not yet provide collision avoidance against other parts or fixtures.

## Version 0.6 Jobs workspace

Jobs contains the part list, expanded nesting options, and sheet cards with interactive previews alongside stock size, material and nine-point sheet origin controls. Nesting, Sheets and Toolpaths no longer have separate navigation entries. Each preview has a toolpath toggle, mouse placement/rotation, duplicate/delete, placement locks, and source-part editing. Reusable layouts remain in the Jobs sidebar. Remove empty sheets cleans up unused sheet records in one undoable edit.

Nesting Settings contains time limits, pass and stagnation limits, candidate detail and the maximum sheet count. Every job or sheet search generates a fresh random seed; the last seed is displayed for diagnostics. Rotation steps accept integers from 1 through 90 degrees. The search continues filling the current sheet after a timed-out partial batch, tests contact candidates before grid sampling, and avoids redundant orientations for symmetric parts. An untouched default-material sheet can adopt the first requested stock; explicitly assigned stock remains unchanged. Synthetic regression coverage includes 50 washers consolidating from four sparse sheets onto the first sheet.

Automatic gauge presets include every gauge from 7 through 26 for carbon steel, stainless and aluminum, including 11 Ga. Gauge dimensions follow the linked McNICHOLS source. Process settings without an exact captured thickness match still require verification.

## Version 0.5 adaptive nesting

Open **Jobs > Nesting options** to configure a whole job, or use **Nest sheet** in a sheet preview. Options are saved in the job:

- Automatic time allocation considers requested copies, geometry complexity, rotation choices, constraints and Fast/Balanced/Thorough effort. It can extend the current allocation after improvements, up to an editable ceiling (300 seconds by default, maximum 900). Fixed mode sets one shared limit for the search. These are soft limits: an individual geometry operation may finish after the deadline; worker cancellation remains available.
- Packing method selects automatic bounds plus SVGnest, explicit SVGnest outlines, or fast bounding boxes. Locks, grain rules, non-quarter-turn rotation, hole nesting and stock restrictions use constrained outline placement. Candidate detail changes that candidate search.
- Part ordering supports net area, longest side, perimeter and list order. Layout goals target compact occupied area, used height or used width. Multi-pass optimization has a pass limit and stagnation limit; each search records its randomly generated seed. Whole-job ranking first prefers more placed copies and fewer used sheets.
- Job policies can disallow extra sheets, limit total sheets, or keep current placements while filling remaining quantities. Locks always remain fixed. New sheets copy a compatible stock template. The creation ceiling prevents adding sheets beyond that count; existing sheet records are retained even if already above it. The format supports at most 2,000 placements per sheet and 20,000 per job.
- Job nesting packs batches instead of repacking the sheet after each individual copy. It tries large parts early and reserves candidate space for small filler parts. Identical shapes are not retried after a completed candidate search; timed-out batches can continue on the same sheet. Clearance uses each part's effective process and contour lead overrides.
- Progress shows copies placed, pass, elapsed time and the current allocation. **Stop & keep best** applies the latest validated checkpoint; **Cancel search** keeps the original job. Budget exhaustion returns the best validated layout and reports remaining quantities instead of discarding the search. A valid existing layout remains eligible if a new attempt fits fewer copies. Results are one undoable edit. These bounded heuristics do not prove an optimum or impossibility.

MCP `nest_job` accepts optional `settings` using the job nesting schema. It saves the best job (including partial placement results) and returns the job fields plus `nestingResult`: placed/total counts, unplaced part quantities, reason, time, pass and extension information. The saved file contains the job and options, not transient progress metadata.

Verification includes synthetic mixed-part jobs, timeout recovery, cancellation, checkpoint retention, undo/redo, locks, instance scale/rotation, sheet limits, clearance and legacy settings. On this Windows workstation, example fixtures completed 1,000 rectangles in roughly 0.2 seconds and 2,000 fast-mode copies in roughly 0.5 seconds; this is a synthetic check, not a runtime guarantee for arbitrary drawings.

## Version 0.4.1 corrections

The nine-point origin selector uses connected corner/T markers around a rectangle, with a cross at the center. Aluminum gauge defaults now follow the nominal sheet-stock column of the [McNICHOLS chart](https://assets.mcnichols.com/content/dam/mcnichols/resources/PDF/DPM-GA-WGTS-PRIMARY-MATL.pdf): 8=.125, 10=.100, 12=.080, 14=.063, 16=.050, 18=.040, 20=.032, 22=.025, and 24=.020 inches. Regeneration updates automatic library presets; user-edited defaults and embedded job thicknesses are preserved. Existing cutting data is reused only at exact thickness matches; other gauge profiles require verified process settings.

## Version 0.4 settings

- **Machine** in the navigation, or **View > Machine settings**, controls per-model kerf, abrasive usage (g/min), and maximum cutting width/height. Defaults are saved locally for new jobs; each job embeds its own machine settings. Older jobs retain their existing material process values until machine settings are applied. Fresh Desktop and Pro profiles use the observed demo kerf of 0.038 in (0.9652 mm). Both remain editable; existing job values are preserved.
- **Cuts & tabs** contains part lead length, tab width/count, and **Stock to leave**. Allowance is per side: positive values enlarge outside profiles and reduce holes, while negative values do the reverse. Source geometry is unchanged. Open paths do not receive stock allowance and raise a warning. Nesting reserves positive allowance and the preview checks finished-part overlap.
- Click a contour in the preview to select it; its individual lead length, kerf side, tabs and entry settings appear below the part defaults. Process contains feed, pierce dwell and pierce diameter. An absent or zero pierce diameter resolves dynamically to kerf; a positive measured value overrides it.
- Material selectors have separate **Material**, **Thickness**, and **Quality** lists. Sheets select material/thickness only. Different quality profiles can share compatible physical stock, including legacy profiles without a stock identifier.
- The nine-point WCS picker chooses the origin on the sheet; it does not move stock on the machine bed. Existing X/Y bed placement is preserved for old files. MCP `inspect_job` returns millimeter `workMoves` relative to this origin alongside bed preview moves.
- **View > Display units** switches length and feed displays between mm and inches. Stored geometry and MCP coordinates remain millimeters. **View > Show file labels** toggles preview labels. Both preferences persist locally. Copy/paste remains in Edit and on Ctrl+C/V; sidebar clipboard buttons are removed.

## Version 0.3 workflow

Part editing has its own workspace, opened by a part row's pencil icon, **New part**, or **Edit source part** on a sheet. The former Design navigation item is removed. The editor has **Geometry**, **Cuts & tabs**, and **Process** sections, with the existing drawing, node, clipboard, transform and cutting tools. Its view fits the part and uses a drawing grid without bed or stock overlays. **Done editing** returns to the calling job/sheet view. Changes update the reusable part and its placed copies; Save still writes the complete job to disk. Drawing commands invoked outside the editor create a new part and open this workspace.

DXF construction `POINT` markers are skipped with an import notice; outlines, holes and dimensions are retained. Points are not converted into cuts or pierces. A point-only drawing reports that it contains no cuttable paths.

- Jobs lists parts with quantity, the full preset catalog, and pencil/trash actions beside the material selector. Sheet cards on Jobs define width, height and material; the graphical origin picker is also available in Sheets.
- Cutting settings and contour overrides live in the part editor. Select **Set pierce entry** or **Place tabs on profile**, then click the contour. Entry percentages are no longer shown on Jobs.
- **Presets** combines saved defaults and the captured WAM reference selector. Gauge profiles use material-specific nominal US sheet thicknesses. A Pro material selected for Desktop copies its stock identity with custom Desktop process defaults; it does not reuse Pro feed rates. Gauge sizes without exact captured settings are marked as requiring verification.
- **Nesting** offers 15/30/45/90 degree rotation steps, per-part fixed/X/Y grain rules, locked sheet placements, adaptive or fixed search budgets, bounded multi-start optimization, optional nesting inside holes, and saved layouts. Locks preserve placement transforms during both sheet and job nesting. Saved layouts include the complete job and are stored in the local defaults database for use in later jobs.
- **Remnants** is a placeholder. Remnant inventory and offcut editing are deferred.
- The file picker accepts multiple SVG/DXF files with normal Ctrl/Shift selection. Each successful file becomes its own part when importing a batch; failed filenames are reported and successful files are retained in one undoable change.

SVG import supports definitions, local use/symbol references, gradients/styles, namespace-prefixed SVG, standard doctypes, transformed geometry, physical sizing, and vector clipping, including object-bounding-box clips. Clipped boundaries become actual cut geometry. Scripts, events and editor metadata are removed. Text, raster images and appearance effects are outlined by the artwork pipeline described above. Remote resources are not fetched; local supporting assets are embedded when available. Arbitrary SVG artwork cannot be guaranteed to become valid waterjet geometry automatically.

Gauge tables distinguish carbon steel, stainless and aluminum. Steel/stainless nominal values follow the [McNICHOLS chart](https://assets.mcnichols.com/content/dam/mcnichols/resources/PDF/DPM-GA-WGTS-PRIMARY-MATL.pdf); aluminum uses the nominal sheet-stock values in the same chart. Nominal gauge is a convenience: the numeric thickness remains editable for measured stock. Gauge conversion supplies dimensions, not verified cutting parameters.

## Jobs, parts and sheets

Navigation contains **Jobs, Remnants, Presets, MCP and Machine**. Jobs opens the setup workspace: assign quantities and materials in the part list, then use its pencil icon to edit geometry and cutting settings in the part editor. Process edits create a part-specific profile while retaining physical stock identity. Pick entry positions and tabs directly on the profile. Uploaded parts stay in job setup.

Each Jobs sheet card shows its metadata beside an interactive bed/stock preview. **Show toolpaths** overlays cut, rapid, tab and pierce geometry; cut checks are available below that preview.

A job contains reusable part definitions and any number of sheets. Material and sheet settings are shared within the job; each part has its own requested quantity. Placements reference the part definition. Edit a definition once to update its copies. Upload SVG/DXF parts, or choose **New part** and draw with the rectangle, circle or polygon tools. Copying a placed part increases its requested quantity when needed.

Sheets inherit the job's stock size, material and nine-point coordinate origin; legacy X/Y bed placement is retained. The preview shows the full bed, physical stock, usable sheet area and placed parts in that order. Fit stock zooms in for editing. **Nest job** places requested quantities and creates additional matching sheets as needed.

In a part editor, select a contour to override inside/outside/centerline compensation, place tabs with individual widths, or set its entry position. The part editor edits job cutting settings; **Presets** manages the reusable defaults database. Jobs embed their material settings, so editing database defaults does not silently change existing jobs. Apply a preset explicitly to use new values. The database supports JSON import/export and includes captured WAM Pro defaults; unsupported thicknesses and Desktop settings still require custom values.

Set a known pierce diameter to preview its footprint and receive warnings when it reaches a finished profile or stock boundary. A zero diameter means unknown and produces an unverified-clearance warning. These checks do not replace machine validation.

The application starts with an empty job each time; it does not restore the previous session or load sample parts. **New**, **Open**, **Save**, **Save As** and **Export SVG** are in the Windows File menu. **View → Commands** opens the command palette (Ctrl+K). The workspace has no duplicate app header; the job name and unsaved-change marker appear in the window title. Save first asks for a filename; later saves update that file. Save As creates another copy. New, Open and closing the desktop app offer Save / Don't Save / Cancel when the job has unsaved changes. Undo history resets when opening or creating a job.

Jobs save as self-contained `.wam` files using JSON job schema version 2. Each file includes all part geometry, quantities, sheet placements, stock sizes, WCS origins, material settings, leads, tabs and entry locations. Original SVG/DXF files are not needed to reopen a saved job. Open also accepts the earlier `.wam.json` and `.job.json` formats, including version 1 migration. Opening a file does not modify it until Save. Browser development mode uses downloads/file selection; native overwrite and Save As dialogs are available in Electron.

Material presets save automatically to the local material database and remain available when you create or open any job. Jobs retain their own process snapshots, so changing a preset does not alter previously saved jobs. Previous draft storage is left untouched for recovery, but is no longer opened automatically.

## Run

Requires Node.js 24 and npm for development. Dependencies are downloaded during installation; the built application works offline.

```powershell
npm ci
npm run desktop
```

`npm run dev` opens the development server at http://127.0.0.1:5173. `npm run package` builds a Windows installer and portable executable under `release/`, with publishing disabled. A packaged app needs no Node.js installation for its editor. Builds are currently unsigned.

## Update from GitHub

In the Windows app, choose **Help → Update from GitHub…**. It checks stable releases from `AudacityMicro/WamLocal` only when requested. You can decline the download, or download and defer installation. Choosing **Install and restart** closes the app and opens the installer; save project files first. Download checksums are verified by `electron-updater`. Failed checks never report the app as up to date.

The editor continues to work offline. The updater uses its own Electron session; renderer network requests remain blocked. No GitHub token is embedded. The repository and release assets must be publicly accessible. Development builds show a packaged-app message instead of contacting GitHub. For portable or unpacked copies, updating installs the new version and creates the installed app's desktop shortcut; it does not overwrite the portable folder in place.

The repository has no published releases as of 2026-11-10, so a live newer-version install cannot yet be validated. Release checks, cancellation, deferred installation and verification failures have automated coverage; a real two-version upgrade remains a release check.

`.github/workflows/windows-release.yml` builds and tests the Windows artifacts. A manual workflow run uploads build artifacts without publishing. A pushed `v<package.json version>` tag also publishes a release containing the installer, blockmap and `latest.yml`. Increase the package version before each subsequent release. No release is published by local packaging. Keep all update assets together in the same release.

## Working features

- Separate WAZER Desktop and Pro profiles, each with a 460 × 305 mm maximum envelope. The library includes 560 full Pro process references and 1,700 both-machine feed records. All supported common sizes have coarse/medium/fine choices; incomplete process settings remain flagged.
- Millimetre-based SVG canvas, zoom, pan, grid snapping, object movement and numeric position, rotation and scale.
- SVG import with physical sizing, transformed groups, configurable curve flattening (default 0.01 mm), primitive shapes and compound holes. Definitions, references and vector clips are resolved; text/images/effects become cut outlines. SVG documents without physical units use 96 px/in.
- DXF lines, straight/bulged polylines, circles, arcs, ellipses, rational/periodic splines and recursive INSERT blocks, plus the additional artwork entities described above. Standard `$INSUNITS` values and text/binary encodings are decoded; missing units use the selected fallback. Curve tolerance accounts for block scaling. Fit-point-only curves are reconstructed with an explicit review notice. Tilted geometry, meshes, opaque solids and unresolved external references remain unsupported.
- Rectangle, circle and polygon/polyline creation, node dragging, duplicate, delete, keyboard nudging and undo/redo.
- Copy/paste selected parts with Ctrl+C/Ctrl+V, clipboard buttons, or the Windows Edit menu. Copies preserve geometry, holes and transforms, work between Wam Local jobs/windows, get new IDs, and offset each repeated paste by 8 mm. Normal text editing keeps its own clipboard behavior. External CAD/SVG clipboard formats are not imported by paste; use vector import for those.
- Double-click a part on the bed to reveal four mouse rotation handles and on-part Duplicate/Delete buttons. Rotation keeps the part center fixed; Shift snaps to 15° increments. Click another part, click the background, or press Escape to dismiss the controls. A rotation drag undoes as one action.
- Shape-aware nesting uses the MIT-licensed SVGnest placement worker, with no-fit polygons, optional 90° rotations, margins and spacing. MaxRects supplies a fast initial candidate. Optimization runs in a cancellable background worker; results are independently checked against buffered outlines and sheet bounds. This bounded heuristic can miss a valid fit and does not prove an optimum. Optional hole nesting and locked/grain constraints use a bounded polygon-based candidate search; disconnected islands remain conservative in the default SVGnest path. Kerf/lead allowances are reserved, while pierce footprints receive separate preflight checks.
- Clipper-based inside/outside kerf compensation, centerline paths, hole-first ordering, evenly spaced outer-contour tabs, scrap-side straight lead previews, path scrubbing and animated simulation.
- Warnings for degenerate/open contours, disappearing kerf offsets, actual shape overlap, toolpaths outside stock, unplaced quantities, WCS envelope limits and pierce interference. These remain preliminary machining checks.
- Approximate cut + pierce time using the entered feed and pierce time. Does not include acceleration, rapid travel, dwell variations, abrasive consumption or setup overhead.
- Self-contained `.wam` jobs with native Open/Save/Save As, unsaved-change prompts and a separate automatically saved material database; SVG layout export in physical millimetres.
- Twenty-one MCP tools sharing the editor's schemas, job workflow, nesting, material database and preview code. Ten legacy project tools remain available for version 1 files.

**Machine-ready `.gcode` output is intentionally not implemented yet.** No machine control, USB connection, or pump/abrasive commands are emitted. Simulation is a geometry preview; leads, containment and cutting order need further validation. See [ROADMAP.md](ROADMAP.md) for the work needed to reach functional parity.

## Editing shortcuts

| Action | Shortcut |
| --- | --- |
| Commands | Ctrl+K |
| New / open job | Ctrl+N / Ctrl+O |
| Save / save as | Ctrl+S / Ctrl+Shift+S |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z |
| Duplicate | Ctrl+D |
| Copy / paste selected part | Ctrl+C / Ctrl+V |
| Show rotation handles and part actions | Double-click a part on the bed |
| Snap mouse rotation | Hold Shift while dragging a rotation handle |
| Delete selected part | Delete |
| Select / nodes / polygon pen | V / N / P |
| Nudge selected part | Arrow keys; Shift for 10 mm |
| Finish closed polygon / open polyline | Enter / Shift+Enter |
| Cancel drawing | Escape |
| Pan / zoom | Alt+drag or middle-drag / wheel |

Imported vectors are initially one part, preserving the relative placement of contours and holes. Node editing changes the flattened geometry, not original Bézier control handles. Job files keep geometry in local coordinates and store object transforms separately. Save writes through a temporary file and rename; failed validation or writes leave the previous saved job intact. Files are not watched for external edits.

## MCP setup

The server uses **stdio**, not HTTP. It has no network listener. Configure a client to launch it with a dedicated project folder:

```json
{
  "mcpServers": {
    "wam-local": {
      "command": "node",
      "args": ["C:/path/to/WamLocal/node_modules/tsx/dist/cli.mjs", "C:/path/to/WamLocal/src/mcp/server.ts"],
      "env": {"WAM_PROJECT_DIR": "C:/path/to/waterjet-projects"}
    }
  }
}
```

After building, Node can launch `dist-mcp/server.mjs` directly with installed production dependencies. The Electron executable can also host the server through its embedded Node runtime, without Node installed. Point MCP clients at the **unpacked application executable**, not the portable self-extraction wrapper:

```json
{
  "mcpServers": {
    "wam-local": {
      "command": "C:/path/to/WamLocal/release/win-unpacked/Wam Local.exe",
      "args": ["C:/path/to/WamLocal/release/win-unpacked/resources/app.asar/dist-mcp/server.mjs"],
      "env": {"ELECTRON_RUN_AS_NODE": "1", "WAM_PROJECT_DIR": "C:/path/to/waterjet-projects"}
    }
  }
}
```

Copy the entire `win-unpacked` directory when installing this form of the app. Keep MCP project files in a normal writable directory outside the app package. Without `WAM_PROJECT_DIR`, the server uses `projects/` relative to its working directory. Accepted filenames are simple names such as `bracket.wam`, `bracket.wam.json` or `bracket.job.json`, with no directory separators. Mutations are serialized and saved through a temporary file and rename.

| Tool | Purpose |
| --- | --- |
| `create_project` | Create a project; fails if the filename already exists |
| `read_project` | Read a saved project |
| `write_project` | Save a complete validated project, including custom contours/settings; overwrites the named file |
| `add_shape` | Add a rectangle or circle |
| `update_part` | Replace a part by its ID |
| `nest_project` | Nest all parts on one stock sheet |
| `inspect_toolpaths` | Return moves, warnings and estimated time |
| `export_svg` | Return a dimensioned SVG layout |
| `list_material_presets` | List exact captured Pro records, quality feeds, source and outlier reasons; filter by machine and optional exact material name |
| `apply_material_preset` | Apply a record by preset ID and quality; reject machine mismatch and outliers |
| `create_job`, `read_job`, `write_job` | Create, load/migrate and save version 2 jobs |
| `add_job_part`, `update_job_part` | Manage reusable geometry, quantities and part materials |
| `add_sheet`, `update_sheet` | Manage sheet stock, material and WCS origin |
| `nest_job` | Place requested quantities across compatible sheets |
| `inspect_job` | Return job issues and per-sheet previews, including bed-coordinate moves |
| `read_material_library`, `write_material_library` | Read/save the reusable defaults database |

The ten project tools above the job tools operate on the legacy version 1 schema. Use the job tools for new files. The desktop database lives in Electron's user-data directory as `material-library.json`; MCP defaults to `%APPDATA%/wam-local/material-library.json`. Set `WAM_MATERIAL_LIBRARY` to the desired shared database path when using a different profile. Database writes are serialized within each process; avoid concurrent writers.

The server and editor share **files**, not an in-memory session. Save from the editor before using MCP on that project; reopen it to load MCP changes. Avoid editing the same file independently in multiple clients. A single server serializes its own writes; separate server processes do not share a lock. Live synchronization is planned.

## Checks

Live WAM 2.5.0 **Pro** reference jobs have now been captured and compared. See [reference results](fixtures/wam-reference/RESULTS.md) for the five cases, measured differences, source exports, and the untested Desktop scope. Independent posting is implemented; physical cut and firmware-specific validation remain pending.

Material reference coverage now includes 560 full Pro thickness records across 24 materials, plus 1,700 feed-only thickness captures across both catalogs. Exact common-size feeds are preserved for all three qualities. Thirty-four full Pro records have invalid tab/lead defaults and remain flagged. Desktop pierce/lead settings are not established by the demo. Bounded custom-thickness estimates require review; see the [both-machine report](fixtures/wam-reference/materials/BOTH-MACHINES.md).

Regenerate the bundled preset data from the original reference records with `node scripts/build-material-presets.mjs` after adding validated captures. The regression suite compares every bundled quality feed and parameter against those source captures.

```powershell
npm test
npm run build
npm run verify:mcp
# Start npm run dev in another terminal for the UI check:
npx playwright install chromium
npm run verify:ui
```

`scripts/verify-electron.mjs` exercises the built Electron app and bundled MCP server. `npm audit` checks dependency advisories. The minimatch override selects the patched package used by build tooling; retain packaging checks when updating it.

## Architecture

- `src/core/model.ts`: geometry types, primitives and legacy project schema; `job.ts` and `job-ops.ts` define version 2 jobs and operations.
- `src/core/nesting.ts`: SVGnest/MaxRects adapter, no-fit polygons and placement validation. `src/vendor/svgnest/` contains the adapted MIT placement worker.
- `src/core/geometry.ts`: transformations, compensation, nesting, preview planning and SVG export. No React or Electron dependency.
- `src/core/import.ts`: strict browser SVG and DXF import adapters.
- `src/ui/`: React workbench and job document lifecycle. `src/desktop/job-files.ts` validates and reads/writes job files; `electron/job-files.cjs` owns native dialogs, current document paths, sender validation and the close guard.
- `src/mcp/server.ts`: file-based stdio server, using the shared core.
- `electron/main.cjs`: isolated/sandboxed renderer, network request blocking, and native application menu. `electron/preload.cjs` exposes part copy/paste commands and fixed-path material database load/save through a sender-checked bridge; it does not expose Node or arbitrary filesystem access. `electron/updates.cjs` implements the manual GitHub update flow. The bundled MCP server runs separately in Electron's embedded Node mode.
- `dist-mcp/`: generated Node-compatible server bundle, packaged beside the editor.

The packaged renderer uses a content security policy and loads local assets. Editing requires no account or hosted API. No analytics, remote fonts, or WAZER code/assets are used. The optional manual updater contacts GitHub from the main process. WAZER/WAM names identify the target equipment and reference workflow; this project is independent of WAZER.

## Functional references

The implementation was built independently from public workflow descriptions and browser-exported reference jobs. No WAM code is included. A public browser asset was inspected during material investigation to locate the calculation boundary; its code was not copied.

- [WAZER project workflow](https://support.wazer.com/resources/preprocessing-temp/general-project-workflow)
- [File compatibility](https://support.wazer.com/resources/maintenance/wam-procedures/file-import-check-list)
- [Tabs and leads](https://support.wazer.com/wam-procedures-/background-and-operation-on-tabs-and-leads)
- [Machine specifications](https://wazer.com/waterjets/tech-specs/)

See [THIRD_PARTY.md](THIRD_PARTY.md) for component attribution and nesting-engine considerations.

## Inline calculator and preset saving (0.19.0)

Numeric fields accept arithmetic (`+ - * / ^`), parentheses, fractions (including `1 1/2 in`), scientific notation, `pi`, and `sqrt`, `abs`, `round`, `floor`, `ceil`, `min` and `max`. Expressions calculate on Enter or when leaving the field. Escape cancels the edit. Invalid expressions and incompatible units restore the prior value and show an error border with an explanatory tooltip. Limits and whole-number quantity requirements still apply.

Explicit units convert into the field's displayed units: `1/8 in` in a millimetre length field, `25.4 mm` in an inch field, `2 in * 3 in` in an area field, `1 in/s` in a feed field, `1 min + 30 s` for pierce time, and `pi rad` for rotation. Bare numbers use displayed units. Lengths support mm, cm, m, in, ft, yd, mil/thou and microns; time and mass units support compatible rate and cost conversions. Currency exchange is not performed.

The **Presets** page has a **Save presets** button with success/failure feedback. It saves the complete shared database locally, including a numeric edit committed by leaving the field. Automatic saving remains enabled. File → Save / Ctrl+S saves presets while that page is active.

Part lists show fitted geometry thumbnails beside each name (0.19.1), including holes and open contours. Empty parts display a dashed placeholder.

### Retaining tabs and tangent leads (0.19.2)

Tab gaps reserve the sideways sweep of tangent entry/exit arcs as well as kerf. The configured tab width describes the minimum finished bridge, including its outer neck; the uncut profile interval can therefore be wider. Adjacent lead paths and their pierce/stop footprints are checked for bridge clearance, and their lengths are reduced when necessary. Tabs take priority over small-hole centroid piercing, avoiding leads that join at the center and release the slug. If the requested bridge cannot physically fit, posting reports a blocking error instead of emitting a disconnected tab. Lead overlap continues to stop at tab gaps. Existing cut files need to be reposted to use the corrected paths.
