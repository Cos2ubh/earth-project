// Geographic grid — meridians + parallels drawn on a unit sphere.
//
// Convention (matches earthSpin's local frame):
//   local +Z = prime meridian (0° longitude) at the equator
//   local +Y = north pole
//   local +X = 90° east at the equator
// A surface point at (lat, lon) in degrees sits at:
//   ( cos(lat)·sin(lon), sin(lat), cos(lat)·cos(lon) )
//
// All lines sit slightly outside radius 1 (RADIUS below) to prevent z-fighting
// with the Earth sphere.

import * as THREE from 'three';

const RADIUS = 1.002;

// Convert (latDeg, lonDeg) → Vector3 on the sphere of given radius.
function latLonToVec3(latDeg, lonDeg, r = RADIUS) {
    const lat = THREE.MathUtils.degToRad(latDeg);
    const lon = THREE.MathUtils.degToRad(lonDeg);
    const cosLat = Math.cos(lat);
    return new THREE.Vector3(
        cosLat * Math.sin(lon),
        Math.sin(lat),
        cosLat * Math.cos(lon),
    );
}

// Build a Line following a single meridian at a given longitude,
// from -latRange to +latRange, sampled every `step` degrees.
function buildMeridian(lonDeg, material, latRange = 89, step = 2) {
    const pts = [];
    for (let lat = -latRange; lat <= latRange + 0.0001; lat += step) {
        pts.push(latLonToVec3(lat, lonDeg));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    return new THREE.Line(geo, material);
}

// Build a Line following a single parallel at a given latitude,
// wrapping fully around the sphere.
function buildParallel(latDeg, material, step = 2) {
    const pts = [];
    for (let lon = 0; lon <= 360 + 0.0001; lon += step) {
        pts.push(latLonToVec3(latDeg, lon));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    return new THREE.Line(geo, material);
}

/**
 * Assemble the full lat/lon grid as a Group. Meant to be added as a child
 * of earthSpin so it rotates with Earth.
 *
 * Layers:
 *   - regular meridians  every 30° longitude, muted
 *   - regular parallels  every 30° latitude,  muted
 *   - equator            bold cyan
 *   - prime meridian     bold amber
 */
export function buildLatLonGrid() {
    const group = new THREE.Group();
    group.name = 'latLonGrid';

    const mutedMaterial = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.18,
    });

    const equatorMaterial = new THREE.LineBasicMaterial({
        color: 0x4ad4c8,
        transparent: true,
        opacity: 0.75,
    });

    const primeMeridianMaterial = new THREE.LineBasicMaterial({
        color: 0xffa54a,
        transparent: true,
        opacity: 0.75,
    });

    // Meridians every 30°, skipping 0° (drawn separately as the prime meridian).
    for (let lon = 30; lon < 360; lon += 30) {
        group.add(buildMeridian(lon, mutedMaterial));
    }

    // Parallels every 30°, skipping 0° (drawn separately as the equator).
    for (let lat = -60; lat <= 60; lat += 30) {
        if (lat === 0) continue;
        group.add(buildParallel(lat, mutedMaterial));
    }

    // Highlighted reference lines.
    group.add(buildParallel(0, equatorMaterial));
    group.add(buildMeridian(0, primeMeridianMaterial));

    return group;
}
