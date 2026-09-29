// Stand-in for satellite.js's optional WebAssembly propagators.
//
// satellite.js re-exports its WASM runtimes from its main entry, so a bundler
// sees `import('#wasm-multi-thread')` even though this app never touches them —
// it only calls the plain-JS SGP4 (twoline2satrec, propagate, gstime,
// eciToGeodetic). Vite's production build can't bundle that multi-threaded
// runtime (top-level await inside a worker), so vite.config.js points both WASM
// imports here. If something ever does try to use them, fail loudly.

export default function wasmUnavailable() {
    throw new Error('satellite.js WebAssembly propagators are not bundled in this app.');
}
