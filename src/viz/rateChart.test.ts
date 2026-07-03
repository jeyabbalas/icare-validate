import { describe, it, expect } from 'vitest';
import { toRateBands, toRateSeries } from './rateChart';

// `toRateSeries` mirrors csvIngest's age,rate rules on the string rows d3-dsv produces. The load-
// bearing case is the blank rate cell: `Number('') === 0`, so a naive finite-check would plot BPC3's
// empty age-85–100 tail as a spurious drop to zero — it must be dropped as missing instead.

describe('toRateSeries', () => {
  it('maps age,rate strings to sorted numeric points', () => {
    const out = toRateSeries([
      { age: '50', rate: '0.002' },
      { age: '40', rate: '0.001' },
      { age: '45', rate: '0.0015' },
    ]);
    expect(out).toEqual([
      { age: 40, rate: 0.001 },
      { age: 45, rate: 0.0015 },
      { age: 50, rate: 0.002 },
    ]);
  });

  it('keeps exact zeros (a true 0 hazard at young ages, not missing data)', () => {
    const out = toRateSeries([
      { age: '0', rate: '0' },
      { age: '1', rate: '0' },
      { age: '2', rate: '4.9e-07' },
    ]);
    expect(out).toEqual([
      { age: 0, rate: 0 },
      { age: 1, rate: 0 },
      { age: 2, rate: 4.9e-7 },
    ]);
  });

  it('drops blank / whitespace rate cells as missing (Number("") === 0 trap)', () => {
    const out = toRateSeries([
      { age: '84', rate: '0.04' },
      { age: '85', rate: '' },
      { age: '86', rate: '   ' },
      { age: '87', rate: undefined },
    ]);
    expect(out).toEqual([{ age: 84, rate: 0.04 }]);
  });

  it('parses upper- and lower-case scientific notation', () => {
    const out = toRateSeries([
      { age: '0', rate: '4.88E-03' },
      { age: '1', rate: '3.89e-04' },
    ]);
    expect(out).toEqual([
      { age: 0, rate: 0.00488 },
      { age: 1, rate: 0.000389 },
    ]);
  });

  it('drops negative rates and non-numeric ages', () => {
    const out = toRateSeries([
      { age: '30', rate: '-0.1' },
      { age: 'abc', rate: '0.1' },
      { age: '31', rate: 'x' },
      { age: '32', rate: '0.05' },
    ]);
    expect(out).toEqual([{ age: 32, rate: 0.05 }]);
  });

  it('returns an empty array when nothing is valid', () => {
    expect(toRateSeries([])).toEqual([]);
    expect(toRateSeries([{ age: '', rate: '' }])).toEqual([]);
  });
});

describe('toRateBands', () => {
  it('maps start_age,end_age,rate rows to start-sorted bands', () => {
    const out = toRateBands([
      { start_age: '40', end_age: '50', rate: '0.02' },
      { start_age: '0', end_age: '40', rate: '0.001' },
    ]);
    expect(out).toEqual([
      { startAge: 0, endAge: 40, rate: 0.001 },
      { startAge: 40, endAge: 50, rate: 0.02 },
    ]);
  });

  it('drops rows with a blank/non-numeric field or end_age ≤ start_age', () => {
    const out = toRateBands([
      { start_age: '0', end_age: '', rate: '0.1' }, // blank end
      { start_age: '50', end_age: '40', rate: '0.1' }, // end < start
      { start_age: 'x', end_age: '10', rate: '0.1' }, // non-numeric start
      { start_age: '10', end_age: '20', rate: '' }, // blank rate
      { start_age: '20', end_age: '30', rate: '0.05' }, // valid
    ]);
    expect(out).toEqual([{ startAge: 20, endAge: 30, rate: 0.05 }]);
  });

  it('parses scientific notation in band rates', () => {
    expect(toRateBands([{ start_age: '0', end_age: '5', rate: '4.88E-03' }])).toEqual([
      { startAge: 0, endAge: 5, rate: 0.00488 },
    ]);
  });
});
