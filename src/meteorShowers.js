// Meteor showers — real annual radiant dates, with a stylized streak effect
// when the simulated date falls within a shower's active window.
//
// Honesty note (matching the project's "label the artistic license" habit,
// same as the moon's compressed distance or the exaggerated terrain relief):
// peak dates here are civil-calendar approximations (month/day, checked
// against the shower's year-independent typical peak) — real peaks drift by
// up to a day or so year to year with Earth's orbital timing, and radiant
// coordinates are the widely-published approximate epoch-2000 values, not
// recomputed precession-corrected ones. Good enough for "hey, the Perseids
// are happening tonight" — not for professional meteor observation planning.
//
// The rendered effect is stylized, not a physical simulation: real meteors
// streak in with motion; these are brief additive flashes at a fixed
// position near the radiant, faded in/out. A believable "the sky is active
// tonight" cue rather than a literal per-meteor trajectory sim.

import * as THREE from 'three';

const OBLIQUITY_DEG = 23.4381;
const STREAK_SPHERE_RADIUS = 55; // inside the star field (r=300), outside everything else

// name, typical peak (month is 1-12), rough ZHR (zenithal hourly rate under
// ideal dark skies — used only to weight how often streaks appear, not
// rendered literally), and the radiant's approximate RA (hours) / Dec (deg).
export const METEOR_SHOWERS = [
    { name: 'Quadrantids', peakMonth: 1, peakDay: 3, zhr: 110, raHours: 15.33, decDeg: 49.5 },
    { name: 'Lyrids', peakMonth: 4, peakDay: 22, zhr: 18, raHours: 18.13, decDeg: 33.6 },
    { name: 'Eta Aquariids', peakMonth: 5, peakDay: 5, zhr: 50, raHours: 22.47, decDeg: -1.0 },
    { name: 'Perseids', peakMonth: 8, peakDay: 12, zhr: 100, raHours: 3.13, decDeg: 58.0 },
    { name: 'Draconids', peakMonth: 10, peakDay: 8, zhr: 10, raHours: 17.47, decDeg: 54.0 },
    { name: 'Orionids', peakMonth: 10, peakDay: 21, zhr: 20, raHours: 6.33, decDeg: 15.6 },
    { name: 'Leonids', peakMonth: 11, peakDay: 17, zhr: 15, raHours: 10.27, decDeg: 21.6 },
    { name: 'Geminids', peakMonth: 12, peakDay: 14, zhr: 120, raHours: 7.53, decDeg: 32.3 },
    { name: 'Ursids', peakMonth: 12, peakDay: 22, zhr: 10, raHours: 14.60, decDeg: 75.3 },
];

const ACTIVE_WINDOW_DAYS = 2.5; // ± this many days around peak counts as "active"

// Day-of-year-ish comparison that's cheap and ignores the calendar year
// entirely (so scrubbing to any year still lights up the right shower).
function daysFromPeak(date, shower) {
    const year = date.getUTCFullYear();
    // Compare against the peak in this year, last year, and next year, and
    // take whichever is closest — handles showers near Jan 1 / Dec 31 wrap.
    let best = Infinity;
    for (const y of [year - 1, year, year + 1]) {
        const peak = Date.UTC(y, shower.peakMonth - 1, shower.peakDay, 12);
        const diffDays = Math.abs(date.getTime() - peak) / 86400000;
        if (diffDays < best) best = diffDays;
    }
    return best;
}

/**
 * Return the active shower closest to its peak for the given date, or null
 * if none are within their active window. { shower, daysFromPeak }.
 */
export function getActiveShower(date) {
    let best = null;
    let bestDiff = ACTIVE_WINDOW_DAYS;
    for (const shower of METEOR_SHOWERS) {
        const diff = daysFromPeak(date, shower);
        if (diff <= bestDiff) {
            bestDiff = diff;
            best = shower;
        }
    }
    return best ? { shower: best, daysFromPeak: bestDiff } : null;
}

// Same equatorial → scene-ecliptic conversion as stars.js (kept local and
// small rather than exporting/importing across modules for one function).
function radiantDirection(raHours, decDeg) {
    const raRad = raHours * 15 * Math.PI / 180;
    const decRad = decDeg * Math.PI / 180;
    const cosDec = Math.cos(decRad);
    const xEq = cosDec * Math.cos(raRad);
    const yEq = cosDec * Math.sin(raRad);
    const zEq = Math.sin(decRad);
    const obl = OBLIQUITY_DEG * Math.PI / 180;
    const cosO = Math.cos(obl);
    const sinO = Math.sin(obl);
    const yEcl = yEq * cosO + zEq * sinO;
    const zEcl = -yEq * sinO + zEq * cosO;
    return new THREE.Vector3(xEq, zEcl, yEcl).normalize();
}

const POOL_SIZE = 26;
const FADE_IN_MS = 60;
const HOLD_MS = 90;
const FADE_OUT_MS = 420;
const STREAK_LIFETIME_MS = FADE_IN_MS + HOLD_MS + FADE_OUT_MS;

/**
 * Build the meteor streak system: a fixed pool of line segments, each
 * independently timed. Returns { group, tick(dtSec, activeShower) }.
 * `group` should be added directly to the scene (world space, not tied to
 * Earth's rotation — meteors burn up in the upper atmosphere, but at this
 * stylized scale they just read as "somewhere out past Earth").
 */
export function buildMeteorShowerEffect() {
    const group = new THREE.Group();
    group.name = 'meteorShowers';

    const pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
        const geometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, 0),
        ]);
        const material = new THREE.LineBasicMaterial({
            color: 0xfff2d6,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const line = new THREE.Line(geometry, material);
        line.visible = false;
        group.add(line);
        pool.push({ line, ageMs: 0, active: false });
    }

    let lastRadiant = null;
    let lastShowerName = null;

    function spawnStreak(radiantDir) {
        const free = pool.find((p) => !p.active);
        if (!free) return;

        // Random axis perpendicular to the radiant direction, so the offset
        // rotation stays on the celestial sphere rather than drifting off it.
        const arbitrary = Math.abs(radiantDir.y) < 0.9
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(1, 0, 0);
        const axis = new THREE.Vector3().crossVectors(radiantDir, arbitrary).normalize();
        const spread = THREE.MathUtils.degToRad(8 + Math.random() * 32);
        const rollAngle = Math.random() * Math.PI * 2;
        axis.applyAxisAngle(radiantDir, rollAngle);

        const headDir = radiantDir.clone().applyAxisAngle(axis, spread);
        const tailDir = radiantDir.clone().applyAxisAngle(axis, spread + THREE.MathUtils.degToRad(3 + Math.random() * 4));

        const positions = free.line.geometry.attributes.position;
        positions.setXYZ(0, ...headDir.multiplyScalar(STREAK_SPHERE_RADIUS).toArray());
        positions.setXYZ(1, ...tailDir.multiplyScalar(STREAK_SPHERE_RADIUS).toArray());
        positions.needsUpdate = true;

        free.active = true;
        free.ageMs = 0;
        free.line.visible = true;
        free.line.material.opacity = 0;
    }

    function tick(dtSec, activeShowerInfo) {
        const dtMs = dtSec * 1000;

        if (activeShowerInfo) {
            const { shower } = activeShowerInfo;
            if (shower.name !== lastShowerName) {
                lastRadiant = radiantDirection(shower.raHours, shower.decDeg);
                lastShowerName = shower.name;
            }
            // Artistic rate: scaled well below the real ZHR (which assumes a
            // whole dark sky and a patient observer) so it reads as "lively
            // sky tonight" rather than a shower of literal dots.
            const spawnPerSecond = Math.min(0.9, (shower.zhr / 3600) * 6);
            if (Math.random() < spawnPerSecond * dtSec) {
                spawnStreak(lastRadiant);
            }
        } else {
            lastShowerName = null;
        }

        for (const p of pool) {
            if (!p.active) continue;
            p.ageMs += dtMs;
            let opacity;
            if (p.ageMs < FADE_IN_MS) {
                opacity = p.ageMs / FADE_IN_MS;
            } else if (p.ageMs < FADE_IN_MS + HOLD_MS) {
                opacity = 1;
            } else if (p.ageMs < STREAK_LIFETIME_MS) {
                opacity = 1 - (p.ageMs - FADE_IN_MS - HOLD_MS) / FADE_OUT_MS;
            } else {
                opacity = 0;
                p.active = false;
                p.line.visible = false;
            }
            p.line.material.opacity = Math.max(0, opacity);
        }
    }

    return { group, tick };
}
