# Both-machine material coverage

Captured from WAM 2.5.0 on 2026-11-17. Common-size coverage is enforced by `src/core/material-coverage.test.ts`. Both capture planners finish with zero pending points.

| Machine | Materials | New feed-only thickness captures | Quality feeds | Full process reference thicknesses |
|---|---:|---:|---:|---:|
| WAZER Desktop | 28 | 1064 | 3192 | 0 |
| WAZER Pro | 24 | 636 | 1908 | 560 |

The shared library contains 7280 records, including user-editable defaults, gauge aliases and all three qualities. Full Pro references include 526 usable process records and 34 with invalid tab/lead defaults that still require review.

Common stock: 0.5, 0.8, 1, 1.2, 1.5, 1.6, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 16, 18, 20, 22, 24 and 25 mm; 1/64, 1/32, 1/16, 3/32, 1/8, 5/32, 3/16, 1/4, 5/16, 3/8, 7/16, 1/2, 5/8, 3/4, 7/8 and 1 inch; material-specific 7–26 gauge steel, stainless and aluminum. Sizes are included only within the WAM limit for that machine/material. Additional thin probes and endpoints are captured.

## Scope and remaining limits

Demo captures contain exact nominal coarse/medium/fine feeds from the visible simulation NC editor. Demo mode disables job/workspace exports and omits M-codes and pierce dwell. These records do not establish Desktop pierce/lead parameters. Unknown values remain null in the evidence and flagged for review in presets; Pro values are never reused as Desktop values. Existing full Pro workspace captures retain their complete process values.

Custom thicknesses use bounded, shape-preserving interpolation between same-machine/material measurements, with a maximum 2.01:1 bracket ratio and no extrapolation. Full-process parameters use full references; Desktop can estimate feeds only and leaves other settings unchanged. Estimates remain flagged until explicitly reviewed. Pierce transitions are not reliably predicted by the model.

Independent common-size Pro feed holdouts: 1746 quality comparisons; worst relative error 7.95% (Polycarbonate - Polycarbonate). The library uses the exact recorded feed at these points. See common-size-feed-holdouts.json. This does not validate pierce settings or physical cut quality.

## Material limits

| Machine | Material | Maximum thickness (in) |
|---|---|---:|
| desktop | Acrylic - Acrylic | 0.687 |
| desktop | Aluminum - 6061 | 0.55 |
| desktop | Aluminum - 7075 | 0.515 |
| desktop | Brass - 260 | 0.423 |
| desktop | Carbon Fiber - Carbon Fiber | 0.346 |
| desktop | Copper - 110 | 0.196 |
| desktop | EPDM - EPDM | 1 |
| desktop | Garolite - G-10/FR4 | 0.773 |
| desktop | Glass - Borosilicate | 0.589 |
| desktop | Glass - Soda Lime | 0.808 |
| desktop | Graphite - Graphite | 1 |
| desktop | HDPE - HDPE | 0.671 |
| desktop | Marble - Marble | 0.764 |
| desktop | Neoprene - 50A | 0.758 |
| desktop | Polycarbonate - Polycarbonate | 0.602 |
| desktop | Polyethylene Foam - 4lb | 1 |
| desktop | Polyurethane - 60A | 0.437 |
| desktop | Silicone - 50A | 0.874 |
| desktop | Stainless Steel - 304 | 0.18 |
| desktop | Stainless Steel - 316 | 0.196 |
| desktop | Stainless Steel - 440C | 0.139 |
| desktop | Steel - 1008 | 0.218 |
| desktop | Steel - 1018 | 0.225 |
| desktop | Steel - 1095 | 0.213 |
| desktop | Steel - 4130 | 0.198 |
| desktop | Steel - O1 | 0.166 |
| desktop | Tile - Ceramic | 0.759 |
| desktop | Titanium - Grade 5 | 0.212 |
| pro | Acrylic - Acrylic | 1 |
| pro | Aluminum - 6061 | 0.95 |
| pro | Brass - 260 | 0.818 |
| pro | Carbon Fiber - Carbon Fiber | 1 |
| pro | Copper - 110 | 0.564 |
| pro | EPDM - EPDM | 1 |
| pro | Garolite - G-10/FR4 | 1 |
| pro | Glass - Borosilicate | 1 |
| pro | Glass - Soda Lime | 1 |
| pro | Granite - Granite | 1 |
| pro | Graphite - Graphite | 1 |
| pro | HDPE - HDPE | 1 |
| pro | Marble - Marble | 1 |
| pro | Neoprene - 50A | 1 |
| pro | Polycarbonate - Polycarbonate | 1 |
| pro | Polyethylene Foam - 4lb | 1 |
| pro | Silicone - 50A | 1 |
| pro | Stainless Steel - 304 | 0.493 |
| pro | Stainless Steel - 316 | 0.444 |
| pro | Steel - 1018 | 0.468 |
| pro | Steel - 1095 | 0.457 |
| pro | Steel - A2 | 0.348 |
| pro | Tile - Ceramic | 1 |
| pro | Titanium - Grade 2 | 0.477 |

Raw evidence: `../desktop-demo/all-material-feeds.json`, `../pro-demo/all-material-feeds.json`, their SHA-256 capture-hash.json files, and the existing full Pro workspace exports. Regenerate shipping data with `node scripts/build-material-feed-captures.mjs`; regenerate this report with `npx tsx scripts/report-material-coverage.ts`.
