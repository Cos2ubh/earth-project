// Progressive texture upgrade — swap 2K → 8K after initial paint.
//
// Strategy:
//   1. Ship 2K by default (~3 MB total, fast initial load).
//   2. After the page is interactive, optionally load 8K in the background
//      (~19 MB) and swap the uniforms in the shader materials.
//   3. Skip auto-upgrade on data-saver connections and on narrow viewports
//      (small screens don't benefit from 8K anyway).
//   4. Allow manual override via the HD button in the UI.

import * as THREE from 'three';

// High-res source images.
//   Earth day/night use NASA Blue Marble Next Generation (10800×5400) — the
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
    // Only wide displays benefit from 8K — small screens waste bandwidth.
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

// Swap a uniform's texture value in place — sets the new texture, then
// disposes the old one to free GPU memory.
function swapUniformTexture(material, uniformName, newTexture) {
    const old = material.uniforms[uniformName].value;
    material.uniforms[uniformName].value = newTexture;
    if (old && old.dispose) old.dispose();
    material.needsUpdate = true;
}

/**
 * Upgrade Earth + cloud + moon textures to 8K in the background.
 * Returns a Promise that resolves when all four have swapped in.
 *
 * refs: {
 *   earthMaterial: ShaderMaterial with uDayTexture, uNightTexture uniforms,
 *   cloudMaterial: ShaderMaterial with uCloudTexture uniform,
 *   moonMaterial:  MeshStandardMaterial with .map,
 * }
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
            }),
            loadTexture(HIGH_RES.earthNight, THREE.SRGBColorSpace).then((tex) => {
                swapUniformTexture(refs.earthMaterial, 'uNightTexture', tex);
                onProgress?.('earth night');
            }),
        );
    }

    if (refs.cloudMaterial) {
        tasks.push(
            loadTexture(HIGH_RES.clouds, THREE.SRGBColorSpace).then((tex) => {
                swapUniformTexture(refs.cloudMaterial, 'uCloudTexture', tex);
                onProgress?.('clouds');
            }),
        );
    }

    if (refs.moonMaterial) {
        tasks.push(
            loadTexture(HIGH_RES.moon, THREE.SRGBColorSpace).then((tex) => {
                const old = refs.moonMaterial.map;
                refs.moonMaterial.map = tex;
                refs.moonMaterial.needsUpdate = true;
                if (old) old.dispose();
                onProgress?.('moon');
            }),
        );
    }

    await Promise.all(tasks);
}
