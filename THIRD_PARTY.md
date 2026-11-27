# Third-party components

Wam Local's original code and documentation are licensed under the BSD Zero Clause License (`0BSD`); see `LICENSE`. This does not replace the licenses of third-party components, adapted upstream code or externally sourced fixtures. Keep their required notices and comply with their respective terms when redistributing them.

Wam Local is an independent implementation. No WAM source code or branding assets are included, and the application does not use WAZER account services. Test fixtures retain numerical material results and workspaces exported through WAM's normal browser UI. A public browser asset was inspected to locate the material calculation boundary; its code was not copied. See the material reference report for provenance and limits.

Direct runtime components:

| Component | License | Role |
| --- | --- | --- |
| [Electron](https://github.com/electron/electron) | MIT, plus bundled Chromium/Node notices | Desktop runtime |
| [electron-updater](https://github.com/electron-userland/electron-builder) | MIT | User-requested GitHub release checks and Windows installer updates |
| [fflate](https://github.com/101arrowz/fflate) | MIT | ZIP download for batch posting in the browser build |
| [React](https://github.com/facebook/react) | MIT | UI |
| [Paper.js](https://github.com/paperjs/paper.js) | MIT | SVG parsing and curve flattening |
| [dxf-parser](https://github.com/gdsestimating/dxf-parser) | MIT | DXF parsing |
| [maxrects-packer](https://github.com/soimy/maxrects-packer) | MIT | Bounding-rectangle nesting |
| [SVGnest](https://github.com/Jack000/SVGnest) | MIT | Adapted polygon placement worker; attribution in `licenses/SVGnest-MIT.txt` |
| [clipper-lib](https://github.com/junmer/clipper-lib) | Boost Software License 1.0 | Polygon offsets |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | MIT | MCP transport and protocol |
| [Zod](https://github.com/colinhacks/zod) | MIT | Shared validation |
| [Lucide](https://github.com/lucide-icons/lucide) | ISC | Icons |
| [occt-import-js](https://github.com/kovacsv/occt-import-js) and [Open CASCADE Technology](https://github.com/Open-Cascade-SAS/OCCT) | LGPL 2.1; see bundled texts and STEP reader notice | STEP parsing through a separate WebAssembly reader |

Package sources and their notices are retained in dependencies. Electron also includes `LICENSE` and `LICENSES.chromium.html` in its distribution. Production bundling preserves legal comments; refer to the installed package notices for complete terms and transitive dependencies. The application package includes the project license, this notice and the `licenses` directory. See `licenses/STEP-reader-notice.md` for the STEP reader's source, build instructions and replacement procedure.

SVGnest's placement worker is integrated with our no-fit-polygon cache, rotation attempts, validation and time budgets. The full upstream UI and genetic optimizer are not included. Rotation/grain/locked-placement constraints and optional hole nesting use our bounded polygon candidate search alongside the default SVGnest worker. Deepnest and libnest2d are not included. See `src/vendor/svgnest/README.md` for the adaptation details.
