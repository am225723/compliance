import { describe, it, expect } from 'vitest';
import { getPresetRange, parseWallClockDate } from '../dateRanges';

describe('dateRanges (UTC, referenceDate = 2026-07-27T15:30:00Z, a Monday)', () => {
  const referenceDate = new Date('2026-07-27T15:30:00Z');
  const timeZone = 'UTC';

  it('today', () => {
    const r = getPresetRange('today', { timeZone, referenceDate });
    expect(r.timeMin).toBe('2026-07-27T00:00:00.000Z');
    expect(r.timeMax).toBe('2026-07-28T00:00:00.000Z');
  });

  it('yesterday', () => {
    const r = getPresetRange('yesterday', { timeZone, referenceDate });
    expect(r.timeMin).toBe('2026-07-26T00:00:00.000Z');
    expect(r.timeMax).toBe('2026-07-27T00:00:00.000Z');
  });

  it('last7 (7 calendar days including today)', () => {
    const r = getPresetRange('last7', { timeZone, referenceDate });
    expect(r.timeMin).toBe('2026-07-21T00:00:00.000Z');
    expect(r.timeMax).toBe('2026-07-28T00:00:00.000Z');
  });

  it('last30', () => {
    const r = getPresetRange('last30', { timeZone, referenceDate });
    expect(r.timeMin).toBe('2026-06-28T00:00:00.000Z');
    expect(r.timeMax).toBe('2026-07-28T00:00:00.000Z');
  });

  it('last90 gets no special treatment — same shape as every other preset', () => {
    const r = getPresetRange('last90', { timeZone, referenceDate });
    expect(r.timeMin).toBe('2026-04-29T00:00:00.000Z');
    expect(r.timeMax).toBe('2026-07-28T00:00:00.000Z');
  });

  it('thisMonth', () => {
    const r = getPresetRange('thisMonth', { timeZone, referenceDate });
    expect(r.timeMin).toBe('2026-07-01T00:00:00.000Z');
    expect(r.timeMax).toBe('2026-08-01T00:00:00.000Z');
  });

  it('prevMonth', () => {
    const r = getPresetRange('prevMonth', { timeZone, referenceDate });
    expect(r.timeMin).toBe('2026-06-01T00:00:00.000Z');
    expect(r.timeMax).toBe('2026-07-01T00:00:00.000Z');
  });

  it('custom range is inclusive of both the start and end day', () => {
    const r = getPresetRange('custom', { timeZone, customStart: '2026-07-10', customEnd: '2026-07-15' });
    expect(r.timeMin).toBe('2026-07-10T00:00:00.000Z');
    expect(r.timeMax).toBe('2026-07-16T00:00:00.000Z');
  });

  it('custom range rejects end before start', () => {
    expect(() => getPresetRange('custom', { timeZone, customStart: '2026-07-15', customEnd: '2026-07-10' }))
      .toThrow(/end date must be on or after/i);
  });

  it('custom range requires both dates', () => {
    expect(() => getPresetRange('custom', { timeZone, customStart: '2026-07-10' })).toThrow();
  });

  it('rejects an unknown preset id', () => {
    expect(() => getPresetRange('not-a-real-preset', { timeZone, referenceDate })).toThrow(/unknown date preset/i);
  });
});

describe('dateRanges DST correctness (America/New_York)', () => {
  const timeZone = 'America/New_York';

  it('spring-forward: "today" on the 23-hour transition day', () => {
    // DST starts 2026-03-08 02:00 EST -> 03:00 EDT in the US.
    const referenceDate = new Date('2026-03-08T18:00:00Z'); // 1pm EDT, after the jump
    const r = getPresetRange('today', { timeZone, referenceDate });
    expect(r.timeMin).toBe('2026-03-08T05:00:00.000Z'); // midnight EST (UTC-5)
    expect(r.timeMax).toBe('2026-03-09T04:00:00.000Z'); // next midnight, now EDT (UTC-4)
    const hours = (new Date(r.timeMax) - new Date(r.timeMin)) / 3600000;
    expect(hours).toBe(23);
  });

  it('fall-back: "today" on the 25-hour transition day', () => {
    // DST ends 2026-11-01 02:00 EDT -> 01:00 EST in the US.
    const referenceDate = new Date('2026-11-01T15:00:00Z'); // 10am local, before the fall-back
    const r = getPresetRange('today', { timeZone, referenceDate });
    expect(r.timeMin).toBe('2026-11-01T04:00:00.000Z'); // midnight EDT (UTC-4)
    expect(r.timeMax).toBe('2026-11-02T05:00:00.000Z'); // next midnight, now EST (UTC-5)
    const hours = (new Date(r.timeMax) - new Date(r.timeMin)) / 3600000;
    expect(hours).toBe(25);
  });
});

describe('parseWallClockDate', () => {
  it('parses a YYYY-MM-DD string into local calendar-day fields', () => {
    const d = parseWallClockDate('2026-07-27');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6); // 0-indexed => July
    expect(d.getDate()).toBe(27);
  });

  it('throws on an invalid string', () => {
    expect(() => parseWallClockDate('not-a-date')).toThrow();
  });
});
