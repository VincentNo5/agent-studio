import { test, expect } from 'bun:test';
import { STUDIO_TIME_ZONE, phaseForZone, studioClock } from '../public/hq3d.js';

// The studio runs on the operators' clock, not the reference build's. Los Angeles keeps DST,
// so a fixed UTC offset would drift twice a year; these instants pin both sides of the switch.
test('the studio clock and day phase follow Los Angeles time, DST included', () => {
    expect(STUDIO_TIME_ZONE).toBe('America/Los_Angeles');
    // 2026-06-01 20:00Z → 13:00 PDT (day). Shanghai would read 04:00, which is the bug.
    expect(studioClock(Date.UTC(2026, 5, 1, 20, 0))).toEqual({ hour: 13, minute: 0, minutes: 780 });
    expect(phaseForZone(Date.UTC(2026, 5, 1, 20, 0))).toBe('day');
    // 2026-01-15 16:30Z → 08:30 PST (day), one hour behind the PDT reading above.
    expect(studioClock(Date.UTC(2026, 0, 15, 16, 30))).toEqual({ hour: 8, minute: 30, minutes: 510 });
    expect(phaseForZone(Date.UTC(2026, 0, 15, 16, 30))).toBe('day');
    // 2026-03-08 10:30Z → 03:30 PDT, the morning after spring forward: still night.
    expect(studioClock(Date.UTC(2026, 2, 8, 10, 30)).hour).toBe(3);
    expect(phaseForZone(Date.UTC(2026, 2, 8, 10, 30))).toBe('night');
    // 2026-06-01 02:30Z → 19:30 PDT, the dusk window.
    expect(phaseForZone(Date.UTC(2026, 5, 1, 2, 30))).toBe('dusk');
    // 2026-06-01 04:00Z → 21:00 PDT, the night window.
    expect(phaseForZone(Date.UTC(2026, 5, 1, 4, 0))).toBe('night');
});
