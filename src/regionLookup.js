// "What is the ISS over?" An offline lat/lon → place-name lookup.
//
// Land: a baked 1° country grid (src/regionGrid.js, generated from Natural
// Earth by scripts/generate-region-grid.mjs). Water: named seas first (a
// handful of circular stamps, good enough at 1° resolution), then the four
// oceans split along their conventional meridians.
//
// Accuracy note (same spirit as the other "label the artistic license"
// comments in this project): this is a decorative caption, not a geodetic
// service. Near coastlines and ocean boundaries it can be off by about one
// degree (~110 km), which the ISS covers in roughly 15 seconds.

import { COUNTRIES, GRID_TOP_LAT, GRID_ROWS, GRID_COLS, GRID_RLE } from './regionGrid.js';

function decodeGrid(rle) {
    const out = new Uint8Array(GRID_ROWS * GRID_COLS);
    let i = 0;
    for (const token of rle.split(',')) {
        const [id, count] = token.split(':');
        const n = parseInt(count, 36);
        out.fill(parseInt(id, 36), i, i + n);
        i += n;
    }
    return out;
}

const GRID = decodeGrid(GRID_RLE);

// name, centre lat, centre lon, radius in degrees of arc. First match wins, so
// keep small/specific seas ahead of large ones.
const SEAS = [
    ['Caspian Sea', 41.8, 50.8, 4.4],
    ['Black Sea', 43.3, 34.6, 3.8],
    ['Persian Gulf', 27.0, 51.5, 3.6],
    ['Red Sea', 15.5, 41.8, 3.2],
    ['Red Sea', 21.5, 37.8, 3.6],
    ['Red Sea', 27.0, 34.2, 2.2],
    ['Gulf of Aden', 12.5, 47.0, 3.5],
    ['Mediterranean Sea', 38.0, 3.0, 5.6],
    ['Mediterranean Sea', 35.5, 17.5, 6.5],
    ['Mediterranean Sea', 34.5, 30.5, 4.0],
    ['Gulf of Mexico', 25.5, -90.0, 6.6],
    ['Caribbean Sea', 14.5, -74.0, 8.0],
    ['Caribbean Sea', 17.0, -84.0, 4.5],
    ['Sargasso Sea', 28.0, -62.0, 6.0],
    ['Gulf of Guinea', 3.0, 2.0, 5.5],
    ['Arabian Sea', 15.0, 65.0, 9.5],
    ['Andaman Sea', 11.0, 96.5, 4.2],
    ['Bay of Bengal', 14.0, 88.0, 8.5],
    ['Java Sea', -5.2, 108.3, 3.0],
    ['Java Sea', -4.6, 113.2, 3.0],
    ['Banda Sea', -5.5, 127.5, 4.6],
    ['Celebes Sea', 3.2, 122.5, 3.3],
    ['Gulf of Thailand', 9.5, 101.5, 3.5],
    ['South China Sea', 12.0, 113.5, 9.0],
    ['East China Sea', 28.5, 126.0, 4.5],
    ['Yellow Sea', 36.0, 123.0, 3.0],
    ['Sea of Japan', 40.0, 135.0, 5.0],
    ['Philippine Sea', 18.0, 133.0, 9.0],
    ['Tasman Sea', -38.0, 160.0, 8.0],
    ['Coral Sea', -17.0, 155.0, 8.0],
];

// Where Central America separates the Pacific from the Caribbean/Atlantic:
// [longitude, latitude] along the middle of the isthmus. Ocean south/west of
// this line is Pacific.
const ISTHMUS = [
    [-95.0, 17.0],
    [-92.0, 15.5],
    [-89.5, 14.2],
    [-87.5, 12.8],
    [-85.0, 11.0],
    [-83.0, 9.8],
    [-80.5, 9.0],
    [-78.0, 8.6],
    [-77.0, 8.0],
];

function isthmusLat(lon) {
    for (let i = 0; i < ISTHMUS.length - 1; i++) {
        const [x0, y0] = ISTHMUS[i];
        const [x1, y1] = ISTHMUS[i + 1];
        if (lon >= x0 && lon <= x1) return y0 + ((lon - x0) / (x1 - x0)) * (y1 - y0);
    }
    return null;
}

function arcDegrees(lat1, lon1, lat2, lon2) {
    const rad = Math.PI / 180;
    const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2
        + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
    return (2 * Math.asin(Math.min(1, Math.sqrt(a)))) / rad;
}

function oceanBasin(lat, lon) {
    if (lat <= -60) return 'Southern Ocean';
    if (lat >= 70) return 'Arctic Ocean';

    // Indian Ocean: 20°E (Cape Agulhas) to 147°E (Tasmania). The seas north
    // of the equator east of Malaysia, and everything north of 10°S beyond
    // New Guinea's western tip, belong to the western Pacific.
    if (lon >= 20 && lon < 147) {
        if (lon >= 104 && lat >= 0) return 'Pacific Ocean';
        if (lon >= 141 && lat >= -10) return 'Pacific Ocean';
        return 'Indian Ocean';
    }
    if (lon >= 147) return 'Pacific Ocean';

    // Americas: Pacific to the west, Atlantic to the east, split at the
    // isthmus in the north and at Cape Horn (67°W) in the south.
    if (lon >= -95 && lon <= -77) {
        const split = isthmusLat(lon);
        if (split !== null) return lat < split ? 'Pacific Ocean' : 'Atlantic Ocean';
    }
    if (lon < -95) return 'Pacific Ocean';
    if (lon < -67 && lat < 8) return 'Pacific Ocean';
    return 'Atlantic Ocean';
}

function waterName(lat, lon) {
    for (const [name, sLat, sLon, radius] of SEAS) {
        if (arcDegrees(lat, lon, sLat, sLon) <= radius) return name;
    }
    return oceanBasin(lat, lon);
}

/**
 * Name the place under a latitude/longitude (degrees).
 * Returns { name, kind } where kind is 'land', 'water' or 'polar' (outside
 * the ±60° grid, which the ISS never reaches).
 */
export function regionAt(latDeg, lonDeg) {
    let lon = ((lonDeg + 180) % 360 + 360) % 360 - 180;
    if (lon >= 180) lon -= 360;

    const row = Math.floor(GRID_TOP_LAT - latDeg);
    if (row < 0 || row >= GRID_ROWS) {
        return { name: latDeg > 0 ? 'Arctic region' : 'Antarctic region', kind: 'polar' };
    }
    const col = Math.min(GRID_COLS - 1, Math.floor(lon + 180));
    const id = GRID[row * GRID_COLS + col];
    if (id) return { name: COUNTRIES[id - 1], kind: 'land' };
    return { name: waterName(latDeg, lon), kind: 'water' };
}
