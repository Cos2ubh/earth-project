// Progressive texture upgrade: swap 2K → 8K after initial paint.
//
// Strategy:
//   1. Ship 2K by default (~3 MB total, fast initial load).
//   2. After the page is interactive, optionally load 8K in the background
//      (~19 MB) and swap the uniforms in the shader materials.
//   3. Skip auto-upgrade on data-saver connections and on narrow viewports
//      (small screens don't benefit from 8K anyway).
//   4. Allow manual override via the HD button in the UI.
//   5. Each texture upgrades independently: one failing (bad network, CDN
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

/**
 * Whether the current environment should auto-upgrade to 8K without
 * the user opting in explicitly.
 */
export function shouldAutoUpgrade() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn?.saveData) return false;
    if (conn?.effectiveType && ['slow-2g', '2g', '3g'].includes(conn.effectiveType)) return false;
    // Only wide displays benefit from 8K. Small screens waste bandwidth.
    if (window.innerWidth < 1400) return false;
    return true;
}

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

// Swap a uniform's texture value in place: sets the new texture, then
// disposes the old one to free GPU memory.
function swapUniformTexture(material, uniformName, newTexture) {
    const old = material.uniforms[uniformName].value;
    material.uniforms[uniformName].value = newTexture;
    if (old && old.dispose) old.dispose();
    material.needsUpdate = true;
}

/**
 * Upgrade Earth + cloud + moon textures to 8K in the background.
 *
 * Each of the (up to) four textures loads and swaps in independently, so a
 * failure on one (bad network, CDN hiccup on that single file) does not
 * hold up or roll back the others. Previously this used Promise.all, which
 * meant one failed fetch reported the *whole* upgrade as failed even when
 * the rest had already swapped in successfully.
 *
 * Returns a summary: { succeeded: string[], failed: { name, error }[] }.
 * onProgress(name) fires per-texture on success, same as before.
 */
export async function upgradeToHighRes(refs, onProgress) {
    const tasks = [];

    if (refs.earthMaterial) {
        tasks.push(
            loadTexture(HIGH_RES.earthDay, THREE.SRGBColorSpace).then((tex) => {
                // Day texture might be temporarily overlaid by historical GIBS
                // imagery. Let the caller decide whether to swap the uniform
                // or just update its "base" reference.
                if (refs.onEarthDayReady) {
                    refs.onEarthDayReady(tex);
                } else {
                    swapUniformTexture(refs.earthMaterial, 'uDayTexture', tex);
                }
                onProgress?.('earth day');
                return 'earth day';
            }),
            loadTexture(HIGH_RES.earthNight, THREE.SRGBColorSpace).then((tex) => {
                swapUniformTexture(refs.earthMaterial, 'uNightTexture', tex);
                onProgress?.('earth night');
                return 'earth night';
            }),
        );
    }

    if (refs.cloudMaterial) {
        tasks.push(
            loadTexture(HIGH_RES.clouds, THREE.SRGBColorSpace).then((tex) => {
                swapUniformTexture(refs.cloudMaterial, 'uCloudTexture', tex);
                onProgress?.('clouds');
                return 'clouds';
            }),
        );
    }

    if (refs.moonMaterial) {
        tasks.push(
            loadTexture(HIGH_RES.moon, THREE.SRGBColorSpace).then((tex) => {
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
    const results = await Promise.allSettled(tasks);

    const succeeded = [];
    const failed = [];
    results.forEach((r, i) => {
        if (r.status === 'fulfilled') succeeded.push(r.value);
        else failed.push({ name: names[i], error: r.reason });
    });

    return { succeeded, failed };
}
