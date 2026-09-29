import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// satellite.js ships optional WebAssembly propagators that its main entry
// re-exports. This app only uses the plain-JS SGP4 (twoline2satrec / propagate),
// and `vite build` cannot bundle the multi-threaded WASM runtime (top-level
// await inside a worker) — the dev server never noticed, the production build
// failed. Pointing the two internal WASM imports at an empty stub fixes the
// build and keeps the unused WASM out of the bundle.
const wasmStub = fileURLToPath(new URL('./src/stubs/satelliteWasm.js', import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            '#wasm-single-thread': wasmStub,
            '#wasm-multi-thread': wasmStub,
        },
    },
});
