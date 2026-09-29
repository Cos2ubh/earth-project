// Optional HD textures, loaded only when the HD button is pressed.
//
// Strategy:
//   1. Ship 2K by default (about 3 MB in total, fast first paint).
//   2. When the HD button is pressed, load the big set in the background and
//      swap the uniforms in the shader materials.
//   3. Nothing loads by itself. The full set needs about 1 GB of graphics
//      memory, more than an integrated GPU can spare. When the GPU runs out,
//      the browser drops the WebGL context and the page goes blank.
//   4. Each texture upgrades independently: one failing (bad network, CDN
//      hiccup) doesn't block or revert the others. See upgradeToHighRes.

import * as THREE from 'three';

// High-res source images.
//   Earth day/night use NASA Blue Marble Next Generation (10800×5400), the
//   cloud-free reference composite. This is a real upgrade over Solar System
//   Scope's 8K because SSC bakes clouds into the day map, which conflicted
//   with our separate cloud layer. NASA imagery is stitched from MODIS at
//   500m/pixel and is public domain.
//   Clouds + moon stay on SSC 8K (best equivalent available for those).
const HIGH_RES = {
    earthDay: '/textures/earth_day_bmng_10k.jpg',
    earthNight: '/textures/earth_night_bm_10k.jpg',
    clouds: '/textures/earth_clouds_8k.jpg',
    moon: '/textures/moon_8k.jpg',
};

// Load one texture with the same colorSpace policy used elsewhere.
function loadTexture(url, colorSpace) {
    return new Promise((resolve, reject) => {
        new THREE.TextureLoader().load(
            url,
            (tex) => {
                tex.colorSpace = colorSpace;
                resolve(tex);
            },
            undefined,
            reject,
        );
    });
}

// What every swap replaced, so a GPU that runs out of memory can go back to the
// small textures. dispose() only frees the GPU copy. The 2K image stays in
// memory and uploads again the next time it is used.
const swaps = []; // { hd, restore }
let generation = 0; // bumped on a revert, so downloads still in flight are dropped
let running = 0; // upgradeToHighRes calls that haven't finished

// Swap a uniform's texture value in place: sets the new texture, then
// disposes the old one to free GPU memory.
function swapUniformTexture(material, uniformName, newTexture) {
    const old = material.uniforms[uniformName].value;
    material.uniforms[uniformName].value = newTexture;
    swaps.push({
        hd: newTexture,
        restore: () => {
            material.uniforms[uniformName].value = old;
            material.needsUpdate = true;
        },
    });
    if (old && old.dispose) old.dispose();
    material.needsUpdate = true;
}

// A texture that arrived after the upgrade was cancelled: throw it away.
function drop(tex) {
    tex.dispose();
    return null;
}

/**
 * Put the small textures back and cancel any HD download still in flight.
 * Returns true if HD had been loaded, or was still loading.
 */
export function revertToBaseTextures() {
    const hadHighRes = swaps.length > 0 || running > 0;
    generation++;
    for (const swap of swaps.splice(0).reverse()) {
        swap.restore();
        swap.hd.dispose();
    }
    return hadHighRes;
}

/**
 * Upgrade Earth + cloud + moon textures to the HD set in the background.
 *
 * Each of the (up to) four textures loads and swaps in independently, so a
 * failure on one (bad network, CDN hiccup on that single file) does not
 * hold up or roll back the others. Previously this used Promise.all, which
 * meant one failed fetch reported the *whole* upgrade as failed even when
 * the rest had already swapped in successfully.
 *
 * Returns a summary: { succeeded: string[], failed: { name, error }[] }.
 * onProgress(name) fires per-texture on success, same as before. A texture that
 * arrives after revertToBaseTextures() is dropped and counts as neither.
 */
export async function upgradeToHighRes(refs, onProgress) {
    const gen = generation;
    const tasks = [];

    if (refs.earthMaterial) {
        tasks.push(
            loadTexture(HIGH_RES.earthDay, THREE.SRGBColorSpace).then((tex) => {
                if (gen !== generation) return drop(tex);
                // Day texture might be temporarily overlaid by historical GIBS
                // imagery. Let the caller decide whether to swap the uniform
                // or just update its "base" reference. It hands back the base
                // it replaced, which is what a revert puts back.
                if (refs.onEarthDayReady) {
                    const base = refs.onEarthDayReady(tex);
                    swaps.push({ hd: tex, restore: () => refs.onEarthDayReady(base) });
                } else {
                    swapUniformTexture(refs.earthMaterial, 'uDayTexture', tex);
                }
                onProgress?.('earth day');
                return 'earth day';
            }),
            loadTexture(HIGH_RES.earthNight, THREE.SRGBColorSpace).then((tex) => {
                if (gen !== generation) return drop(tex);
                swapUniformTexture(refs.earthMaterial, 'uNightTexture', tex);
                onProgress?.('earth night');
                return 'earth night';
            }),
        );
    }

    if (refs.cloudMaterial) {
        tasks.push(
            loadTexture(HIGH_RES.clouds, THREE.SRGBColorSpace).then((tex) => {
                if (gen !== generation) return drop(tex);
                swapUniformTexture(refs.cloudMaterial, 'uCloudTexture', tex);
                onProgress?.('clouds');
                return 'clouds';
            }),
        );
    }

    if (refs.moonMaterial) {
        tasks.push(
            loadTexture(HIGH_RES.moon, THREE.SRGBColorSpace).then((tex) => {
                if (gen !== generation) return drop(tex);
                // Moon is a ShaderMaterial (see moonSurface.js): swap the uniform,
                // keeping the anisotropy the 2K map was set up with.
                tex.anisotropy = refs.moonMaterial.uniforms.uMap.value?.anisotropy ?? 1;
                swapUniformTexture(refs.moonMaterial, 'uMap', tex);
                onProgress?.('moon');
                return 'moon';
            }),
        );
    }

    // allSettled (not all): a rejected texture must not take the others down
    // with it. Each task already carries its own name for reporting.
    const names = ['earth day', 'earth night', 'clouds', 'moon'].filter((n) => {
        if (n === 'earth day' || n === 'earth night') return !!refs.earthMaterial;
        if (n === 'clouds') return !!refs.cloudMaterial;
        if (n === 'moon') return !!refs.moonMaterial;
        return false;
    });
    running++;
    const results = await Promise.allSettled(tasks);
    running--;

    const succeeded = [];
    const failed = [];
    results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
            if (r.value) succeeded.push(r.value); // null: dropped after a revert
        } else {
            failed.push({ name: names[i], error: r.reason });
        }
    });

    return { succeeded, failed };
}
