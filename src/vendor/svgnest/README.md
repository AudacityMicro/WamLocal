# SVGnest placement worker

Source: https://github.com/Jack000/SVGnest/blob/master/util/placementworker.js

Retrieved November 10, 2026. Copyright Jack Qiao, MIT license; the full notice is retained in the source and `licenses/SVGnest-MIT.txt`.

Adaptations: ES module imports/exports, explicit Clipper/geometry dependencies, `this` instead of the upstream parallel-worker environment, and smaller feasible-area thresholds for millimetre geometry. `geometry-adapter.ts` provides the three required geometry helpers.

`src/core/nesting.ts` supplies no-fit polygons using Clipper Minkowski operations (with a convex-outline shortcut), rotation assignments, caching, bounded search and independent result validation. MaxRects is the fast initial candidate. The original SVGnest browser UI, Parallel/eval plumbing and genetic optimizer are not bundled. Nesting inside holes is disabled, and disconnected parts are conservatively grouped by convex hull.
