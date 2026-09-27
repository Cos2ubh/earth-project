// Historical Earth imagery from NASA GIBS (Global Imagery Browse Services).
// For any date >= 2000-05-01, GIBS returns a full-globe equirectangular JPEG
// of Earth's day-side taken by MODIS Terra that day. Drops straight into our
// Earth shader as the day texture — no other changes needed to see hurricanes,
// wildfires, dust storms, ice caps as they actually appeared on that date.
//
// Constraints (documented for the UI):
//   - Earliest available date: 2000-05-01 (MODIS Terra launch)
//   - One image per day (single satellite overpass composite)
//   - Day-hemisphere only — the night side stays as the base city-lights map
//
// CORS: NASA GIBS returns Access-Control-Allow-Origin: * so we can fetch
// directly from client-side JS without a proxy.

import * as THREE from 'three';

const GIBS_MIN_DATE = new Date('2000-05-01T00:00:00Z');

function buildGibsUrl(dateStr) {
    // WMS GetMap request. 2048x1024 = same size as our base Earth textures,
    // so the shader's UV mapping keeps working with no changes.
    const params = new URLSearchParams({
        SERVICE: 'WMS',
        REQUEST: 'GetMap',
        LAYERS: 'MODIS_Terra_CorrectedReflectance_TrueColor',
        STYLES: '',
        FORMAT: 'image/jpeg',
        HEIGHT: '1024',
        WIDTH: '2048',
        BBOX: '-90,-180,90,180',
        CRS: 'EPSG:4326',
        VERSION: '1.3.0',
        TIME: dateStr,
    });
    return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${params.toString()}`;
}

/**
 * Return true if we can fetch a GIBS image for this date.
 * Earliest supported date is MODIS Terra's launch. Anything after "now" (UTC)
 * is skipped because MODIS obviously hasn't imaged the future yet.
 */
export function isDateInGibsRange(date) {
    if (!date) return false;
    if (date < GIBS_MIN_DATE) return false;
    // Give NASA a 24-hour cushion for the latest imagery to appear.
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
    if (date > yesterday) return false;
    return true;
}

/**
 * Fetch the GIBS Earth imagery for a given date.
 * Resolves to { texture, dateStr }. Rejects on network failure or
 * on out-of-range dates (guard with isDateInGibsRange first).
 */
export function fetchHistoricalEarthTexture(date) {
    const dateStr = date.toISOString().slice(0, 10); // YYYY-MM-DD
    const url = buildGibsUrl(dateStr);

    return new Promise((resolve, reject) => {
        new THREE.TextureLoader().load(
            url,
            (texture) => {
                texture.colorSpace = THREE.SRGBColorSpace;
                resolve({ texture, dateStr });
            },
            undefined,
            (err) => reject(err),
        );
    });
}
