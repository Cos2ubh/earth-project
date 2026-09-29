// Bakes a compact "which country is under this lat/lon" grid into
// src/regionGrid.js, so the ISS panel can say "Over Brazil" with no network
// request and no geodata shipped to the browser beyond ~25 KB.
//
// Source data: Natural Earth 50m admin-0 countries (public domain), via the
// `world-atlas` npm package. Nothing here is a runtime dependency, so install
// the helpers without touching package.json:
//
//   npm install --no-save world-atlas topojson-client d3-geo
//   node scripts/generate-region-grid.mjs
//
// Grid: 1° cells, 60°N → 60°S (the ISS never leaves ±51.6°), 360 columns from
// 180°W. Each cell is sampled at 9 points; the most common country wins if it
// covers at least 3 of them, otherwise the cell counts as water. That keeps
// small islands and narrow coastal countries from disappearing while a cell
// that is mostly ocean stays "ocean".
//
// Output is row-major (north → south, west → east), run-length encoded as
// "id:count" tokens in base 36, where id 0 means water.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { feature } = require('topojson-client');
const { geoContains, geoBounds } = require('d3-geo');

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = process.argv[2] || path.join(here, '..', 'src', 'regionGrid.js');

const topology = JSON.parse(
    fs.readFileSync(require.resolve('world-atlas/countries-50m.json'), 'utf8'),
);
const countries = feature(topology, topology.objects.countries).features;

// Natural Earth short names → what reads well after "Over".
const DISPLAY_NAMES = {
    'United States of America': 'United States',
    'United Kingdom': 'United Kingdom',
    'Dem. Rep. Congo': 'DR Congo',
    'Congo': 'Republic of the Congo',
    'Central African Rep.': 'Central African Republic',
    'Dominican Rep.': 'Dominican Republic',
    'Bosnia and Herz.': 'Bosnia & Herzegovina',
    'S. Sudan': 'South Sudan',
    'W. Sahara': 'Western Sahara',
    'Eq. Guinea': 'Equatorial Guinea',
    'Falkland Is.': 'Falkland Islands',
    'Solomon Is.': 'Solomon Islands',
    'Fr. S. Antarctic Lands': 'Kerguelen Islands',
    'N. Cyprus': 'Cyprus',
    'eSwatini': 'Eswatini',
    'Czechia': 'Czechia',
    'Bahamas': 'Bahamas',
    'Philippines': 'Philippines',
    'Netherlands': 'Netherlands',
    'United Arab Emirates': 'United Arab Emirates',
    'Gambia': 'Gambia',
    'Marshall Is.': 'Marshall Islands',
    'Cayman Is.': 'Cayman Islands',
    'Turks and Caicos Is.': 'Turks and Caicos Islands',
    'Faeroe Is.': 'Faroe Islands',
    'Cook Is.': 'Cook Islands',
    'Is. of Man': 'Isle of Man',
    'Fr. Polynesia': 'French Polynesia',
    'N. Mariana Is.': 'Northern Mariana Islands',
    'St. Pierre and Miquelon': 'Saint-Pierre and Miquelon',
    'St-Martin': 'Saint-Martin',
    'St-Barthélemy': 'Saint-Barthélemy',
    'U.S. Virgin Is.': 'U.S. Virgin Islands',
    'British Virgin Is.': 'British Virgin Islands',
    'Br. Indian Ocean Ter.': 'British Indian Ocean Territory',
    'Heard I. and McDonald Is.': 'Heard & McDonald Islands',
    'S. Geo. and the Is.': 'South Georgia',
    'Saint Helena': 'Saint Helena',
    'Vatican': 'Vatican City',
};

// Split every country into single polygons with their own bounding boxes so
// a cell only runs the expensive point-in-polygon test against nearby shapes.
const polygons = [];
const names = [];
for (const f of countries) {
    const rawName = f.properties.name;
    const name = DISPLAY_NAMES[rawName] || rawName;
    let id = names.indexOf(name);
    if (id === -1) {
        names.push(name);
        id = names.length - 1;
    }
    const geom = f.geometry;
    const parts = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    for (const coordinates of parts) {
        const g = { type: 'Polygon', coordinates };
        polygons.push({ id: id + 1, geometry: g, bounds: geoBounds(g) });
    }
}

function inBounds([[west, south], [east, north]], lon, lat) {
    if (lat < south || lat > north) return false;
    if (west <= east) return lon >= west && lon <= east;
    return lon >= west || lon <= east; // crosses the antimeridian
}

function countryAt(lon, lat) {
    for (const p of polygons) {
        if (inBounds(p.bounds, lon, lat) && geoContains(p.geometry, [lon, lat])) return p.id;
    }
    return 0;
}

const TOP = 60;
const ROWS = 120;
const COLS = 360;
const OFFSETS = [-1 / 3, 0, 1 / 3];

const grid = new Uint8Array(ROWS * COLS);
for (let r = 0; r < ROWS; r++) {
    const latCentre = TOP - r - 0.5;
    for (let c = 0; c < COLS; c++) {
        const lonCentre = -180 + c + 0.5;
        const counts = new Map();
        for (const dy of OFFSETS) {
            for (const dx of OFFSETS) {
                const id = countryAt(lonCentre + dx, latCentre + dy);
                if (id) counts.set(id, (counts.get(id) || 0) + 1);
            }
        }
        let best = 0;
        let bestCount = 0;
        for (const [id, n] of counts) {
            if (n > bestCount) {
                best = id;
                bestCount = n;
            }
        }
        grid[r * COLS + c] = bestCount >= 3 ? best : 0;
    }
}

const tokens = [];
let runId = grid[0];
let runLen = 0;
for (const v of grid) {
    if (v === runId) {
        runLen++;
    } else {
        tokens.push(`${runId.toString(36)}:${runLen.toString(36)}`);
        runId = v;
        runLen = 1;
    }
}
tokens.push(`${runId.toString(36)}:${runLen.toString(36)}`);

if (names.length > 255) throw new Error('More than 255 countries — widen the grid storage.');

const body = `// GENERATED FILE — do not edit by hand.
// Produced by scripts/generate-region-grid.mjs from Natural Earth 50m
// countries (public domain, via the world-atlas package).
//
// 1° cells, ${TOP}°N to ${TOP}°S, ${COLS} columns starting at 180°W, row-major
// north to south. Run-length encoded as "id:count" in base 36; id 0 is water,
// id N is COUNTRIES[N - 1].

export const GRID_TOP_LAT = ${TOP};
export const GRID_ROWS = ${ROWS};
export const GRID_COLS = ${COLS};

export const COUNTRIES = ${JSON.stringify(names)};

export const GRID_RLE = '${tokens.join(',')}';
`;

fs.writeFileSync(outPath, body);
const landCells = grid.reduce((n, v) => n + (v ? 1 : 0), 0);
console.log(`wrote ${outPath}`);
console.log(`${names.length} countries, ${tokens.length} runs, ${(body.length / 1024).toFixed(1)} KB, ${landCells} land cells of ${grid.length}`);
