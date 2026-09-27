// Search — natural-language query → date/time to jump to.
//
// Two-stage lookup:
//   1. Fuzzy match against the curated event database (src/events.js).
//   2. Fall back to chrono-node date parsing for explicit dates like
//      "August 29 2005" or "3 months ago" or "next full moon".
//
// Event lookup wins when it hits — "when did katrina happen" is a real intent,
// not a date parse. Chrono is the safety net for queries the event DB missed.

import * as chrono from 'chrono-node';
import { EVENTS } from './events.js';

// Words that carry no meaning for event matching — dropped before scoring.
const STOP_WORDS = new Set([
    'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'but',
    'was', 'is', 'are', 'were', 'be', 'been', 'when', 'what', 'where', 'how',
    'did', 'does', 'do', 'happen', 'happened', 'occur', 'occurred', 'take',
    'took', 'place', 'come', 'came', 'looked', 'look', 'from', 'space',
    'earth', 'like', 'show', 'me',
]);

function normalize(text) {
    return text
        .toLowerCase()
        .replace(/[^\w\s-]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
}

/**
 * Score how well an event matches a query. Returns 0 to Infinity.
 * Higher = better match.
 *
 * Scoring:
 *   +3 per exact keyword-phrase substring match
 *   +1 per shared normalized word between query and any keyword
 *   +2 bonus if the event name shares words with the query
 */
function scoreEvent(event, queryLower, queryWords) {
    let score = 0;

    // Substring hits on the raw query — captures multi-word event names.
    for (const kw of event.keywords) {
        if (queryLower.includes(kw)) score += 3;
    }

    // Word-level overlap on all keywords + the event name.
    const eventWords = new Set([
        ...event.keywords.flatMap((k) => normalize(k)),
        ...normalize(event.name),
    ]);
    for (const w of queryWords) {
        if (eventWords.has(w)) score += 1;
    }

    return score;
}

function findBestEvent(query) {
    const queryLower = query.toLowerCase();
    const queryWords = normalize(query);
    if (queryWords.length === 0) return null;

    let best = null;
    let bestScore = 0;
    for (const event of EVENTS) {
        const s = scoreEvent(event, queryLower, queryWords);
        if (s > bestScore) {
            best = event;
            bestScore = s;
        }
    }

    // Threshold: require at least one substring hit OR two word overlaps.
    if (bestScore < 2) return null;
    return { event: best, score: bestScore };
}

function findBestDate(query, referenceDate) {
    // chrono returns an array of parse results; take the first with a valid date.
    const results = chrono.parse(query, referenceDate, { forwardDate: false });
    for (const r of results) {
        const d = r.start?.date?.();
        if (d && !Number.isNaN(d.getTime())) return { date: d, text: r.text };
    }
    return null;
}

/**
 * Resolve a natural-language query to a jump target.
 * Returns one of:
 *   { kind: 'event', date, event }        — matched a curated event
 *   { kind: 'date',  date, text }         — parsed as a date/time expression
 *   { kind: 'none' }                      — no match
 */
export function resolveQuery(query, referenceDate = new Date()) {
    if (!query || !query.trim()) return { kind: 'none' };

    const eventMatch = findBestEvent(query);
    if (eventMatch) {
        return {
            kind: 'event',
            date: new Date(eventMatch.event.date),
            event: eventMatch.event,
        };
    }

    const dateMatch = findBestDate(query, referenceDate);
    if (dateMatch) {
        return {
            kind: 'date',
            date: dateMatch.date,
            text: dateMatch.text,
        };
    }

    return { kind: 'none' };
}
