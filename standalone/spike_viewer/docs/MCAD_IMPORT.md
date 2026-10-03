<!-- SPDX-License-Identifier: Apache-2.0 -->
# Local board and MCAD import

`adapters/importFiles.ts` exposes one browser-facing entry point:

```ts
importAssemblyFile(file, { signal, meshUnit }): Promise<AssemblyAsset>
```

It accepts a user-selected local `.kicad_pcb`, `.step`/`.stp`, `.iges`/`.igs`, `.glb`, `.stl`, or `.obj` file. It never downloads a model named by the source file. GLB buffers and images must be embedded, and OBJ files that name an external material library are rejected. KiCad footprint model paths remain inert source metadata.

STEP and IGES use `occt-import-js` 0.0.23 in a dedicated classic worker. The adapter asks OCCT for millimetre output, preserves mesh and face colors, mesh names, and B-rep face-to-triangle ranges, then keeps only the tessellation. It does not retain topology suitable for solid or B-rep editing. The browser worker is terminated on cancellation and after 30 seconds. The Node fallback exists for deterministic tests; a synchronous OCCT call already in progress cannot be preempted there.

GLB always follows the glTF convention of metres and Y-up coordinates. The adapter applies the right-handed rotation `[x, y, z] -> [x, -z, y]` to produce the assembly's Z-up coordinates; `meshUnit` is ignored for GLB. STL and OBJ retain their declared source XYZ axes, which the adapter assumes are already Z-up. `meshUnit` applies only to STL and OBJ, which have no dependable unit metadata and default to millimetres. Every returned coordinate is converted to millimetres before `validateAssemblyAsset` admits it. Reflected node transforms are baked into vertex positions and their triangle winding is reversed so picking and normals retain the visible face orientation.

Imports are capped at 64 MiB, with KiCad text capped at 16 MiB. Browser KiCad parsing runs in a worker that is terminated on cancellation and after 10 seconds. Normalized assembly limits are 500,000 vertices, 1,000,000 triangles, and 2,000 meshes per mechanical asset. Invalid numeric data, out-of-range indices, incomplete triangles, invalid face ranges, unsupported formats, and files without usable geometry fail closed.

## Local OCCT runtime

The browser runtime is generated from the installed npm package and should not be fetched from a CDN:

```sh
node scripts/copy-occt-runtime.mjs
```

The script copies `occt-import-js.js`, `occt-import-js.wasm`, both exact installed license texts, a source/relink notice, and the SPIKE worker to `public/vendor/occt-import-js/`. Package scripts run it as `prepare:mcad` before development and demo builds. The generated 7+ MiB runtime directory can remain ignored because it is reproducible from the locked dependency.

`occt-import-js` declares LGPL-2.1 and its official API documents the millimetre `linearUnit` option and result mesh contract. Verbatim license texts from the installed 0.0.23 package are retained in `licenses/OCCT_IMPORT_JS-LGPL-2.1.txt` and `licenses/OCCT-LGPL-2.1.txt`. Inspection of the installed package found no separate file or appendix labelled as an Open CASCADE additional exception, so none is claimed or synthesized. `licenses/OCCT_RUNTIME_SOURCE.txt` records the exact [0.0.23 source tag](https://github.com/kovacsv/occt-import-js/tree/0.0.23) and replacement procedure. See the [official API README](https://github.com/kovacsv/occt-import-js/blob/main/README.md) and [upstream license](https://github.com/kovacsv/occt-import-js/blob/main/LICENSE.md).

## Fixtures and provenance

All three fixtures are original Apache-2.0 SPIKE material:

| Fixture | Purpose | SHA-256 |
| --- | --- | --- |
| `spike-reflector-500x500x5.step` | 500 × 500 × 5 mm OCCT unit and geometry test; copied without modification from `examples/optycal/reflector.step` | `c66e5ec11e98882244f17cc5a5f8aa67edd34705955a4259e7772257315890a2` |
| `controller-board.kicad_pcb` | 40 × 30 mm board with copper, a via, and a footprint | `a6d0e6eb38bdd3ea67dc6f2dd824484dec69e4f9cedffb2e9b21105e93ad27cb` |
| `sensor-board.kicad_pcb` | 25 × 20 mm second board at nonzero source coordinates | `40db1a13d14232f3645c9111decb3c55c37cd8328f6acafcdd2f8dd50c79fbdd` |

The KiCad adapter is an Apache-2.0 extraction of SPIKE's `app/src/boardParser.ts` (`SHA-256 5bb4d5b50b19b2f5aaef55b43419f9c25d7b12ebcc86bb0b1c7556bc9f9a2d03`) and `app/src/numericRange.ts` (`SHA-256 f0220dae11ef29b7d2093ed9e0655e5cbbb16c606d2c5b02a13836db9a323ead`). Duplicate board types were removed in favor of imports from the standalone engine. The adapter performs no filesystem or process access.
