# Third-party components

Wam Local is an independent implementation. No WAM source code or branding assets are included, and the application does not use WAZER account services. Test fixtures retain numerical material results and workspaces exported through WAM's normal browser UI. A public browser asset was inspected to locate the material calculation boundary; its code was not copied. See the material reference report for provenance and limits.

Direct runtime components:

| Component | License | Role |
| --- | --- | --- |
| [Electron](https://github.com/electron/electron) | MIT, plus bundled Chromium/Node notices | Desktop runtime |
| [electron-updater](https://github.com/electron-userland/electron-builder) | MIT | User-requested GitHub release checks and Windows installer updates |
| [React](https://github.com/facebook/react) | MIT | UI |
| [Paper.js](https://github.com/paperjs/paper.js) | MIT | SVG parsing and curve flattening |
| [dxf-parser](https://github.com/gdsestimating/dxf-parser) | MIT | DXF parsing |
| [maxrects-packer](https://github.com/soimy/maxrects-packer) | MIT | Bounding-rectangle nesting |
| [SVGnest](https://github.com/Jack000/SVGnest) | MIT | Adapted polygon placement worker; attribution in `licenses/SVGnest-MIT.txt` |
| [clipper-lib](https://github.com/junmer/clipper-lib) | Boost Software License 1.0 | Polygon offsets |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | MIT | MCP transport and protocol |
| [Zod](https://github.com/colinhacks/zod) | MIT | Shared validation |
| [Lucide](https://github.com/lucide-icons/lucide) | ISC | Icons |

Package sources and their notices are retained in dependencies. Electron also includes `LICENSE` and `LICENSES.chromium.html` in its distribution. Production bundling preserves legal comments; refer to the installed package notices for complete terms and transitive dependencies. No license has yet been selected for this repository's original code.

SVGnest's placement worker is integrated with our no-fit-polygon cache, rotation attempts, validation and time budgets. The full upstream UI and genetic optimizer are not included. Deepnest and libnest2d are not included. See `src/vendor/svgnest/README.md` for the adaptation details.
