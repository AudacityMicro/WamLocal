# STEP reader

STEP import uses the unmodified `occt-import-js` 0.0.23 WebAssembly reader and Open CASCADE Technology. Both LGPL 2.1 license texts distributed with the dependency are included alongside this notice. The CAD reader runs locally, loads on demand, and is not required to open an already imported WAM job.

Corresponding upstream source and build scripts:

- occt-import-js: https://github.com/kovacsv/occt-import-js/tree/c2148e54b456b571238d35cac037d304053d64b2
- Open CASCADE submodule: https://github.com/Open-Cascade-SAS/OCCT/tree/d2abb6d844231cb8f29be6894440874a4700e4a5
- Reader build instructions: https://github.com/kovacsv/occt-import-js#how-to-build-on-windows

The application-specific face extraction code is in `src/core/step-import.ts`; it does not modify the CAD reader. To use a rebuilt or modified reader, replace the dependency's `dist/occt-import-js.js` and `dist/occt-import-js.wasm`, then run `npm run package`. The WASM remains a separate resource in `dist/assets`, rather than being compiled into the application executable. Reverse engineering for debugging modifications to these LGPL libraries is permitted.
