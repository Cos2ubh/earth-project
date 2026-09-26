// Moon orbit ring — traces the Moon's actual path around Earth over one
// sidereal month (27.32 days). Uses the same astronomy engine as everything
// else, so the orbit shows the real 5.14° inclination to the ecliptic and
// the current orientation of the orbital plane.
//
// The orbital plane precesses on an 18.6-year cycle (regression of the nodes),
// so the ring gently shifts over time when the user scrubs.

import * as THREE from 'three';
import { getMoonState } from './astronomy.js';

const SIDEREAL_MONTH_DAYS = 27.321661;
const SAMPLE_COUNT = 180;

/**
 * Build the moon orbit line. Sampled from getMoonState() so the orbit
 * uses the same coordinate frame and same astronomical model as the Moon itself.
 * Distance is normalized to a constant scene radius (matches the moon marker).
 */
export function buildMoonOrbit(sceneRadius, referenceDate = new Date()) {
    const points = [];
    const stepMs = (SIDEREAL_MONTH_DAYS * 86400 * 1000) / SAMPLE_COUNT;

    for (let i = 0; i <= SAMPLE_COUNT; i++) {
        const t = new Date(referenceDate.getTime() + i * stepMs);
        const { direction } = getMoonState(t);
        points.push(new THREE.Vector3(
            direction.x * sceneRadius,
            direction.y * sceneRadius,
            direction.z * sceneRadius,
        ));
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
        color: 0xaabbdd,
        transparent: true,
        opacity: 0.22,
    });

    return new THREE.LineLoop(geometry, material);
}

/**
 * Recompute the orbit points against a new reference date and update the mesh.
 * Cheap enough to call on every time-scrub change.
 */
export function updateMoonOrbit(mesh, sceneRadius, referenceDate) {
    const stepMs = (SIDEREAL_MONTH_DAYS * 86400 * 1000) / SAMPLE_COUNT;
    const positions = mesh.geometry.attributes.position.array;
    for (let i = 0; i <= SAMPLE_COUNT; i++) {
        const t = new Date(referenceDate.getTime() + i * stepMs);
        const { direction } = getMoonState(t);
        positions[i * 3 + 0] = direction.x * sceneRadius;
        positions[i * 3 + 1] = direction.y * sceneRadius;
        positions[i * 3 + 2] = direction.z * sceneRadius;
    }
    mesh.geometry.attributes.position.needsUpdate = true;
}
