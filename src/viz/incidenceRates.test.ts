import { describe, it, expect } from 'vitest';
import { buildIncidenceSeries } from './incidenceRates';
import type { IncidenceRates } from '../services/resultNormalizer';

// `buildIncidenceSeries` zips the normalized incidence frame into tidy long-form points. The load-bearing
// distinction is NaN vs 0 in the study rate: a NaN study rate is "nobody at risk at this age" and must be
// dropped (while that age's population point survives); a true 0 is an at-risk-but-event-free age and must
// be kept. Population points appear only when a population-rate column was provided.

function inc(age: number[], study: number[], population: number[] | null): IncidenceRates {
  return {
    age: Float64Array.from(age),
    studyRate: Float64Array.from(study),
    populationRate: population === null ? null : Float64Array.from(population),
  };
}

describe('buildIncidenceSeries', () => {
  it('zips parallel arrays into tidy points, study before population within each age', () => {
    const out = buildIncidenceSeries(inc([40, 50], [0.001, 0.002], [0.0011, 0.0021]));
    expect(out).toEqual([
      { age: 40, rate: 0.001, series: 'study' },
      { age: 40, rate: 0.0011, series: 'population' },
      { age: 50, rate: 0.002, series: 'study' },
      { age: 50, rate: 0.0021, series: 'population' },
    ]);
  });

  it('drops a NaN study rate (nobody at risk) but keeps that age population point', () => {
    const out = buildIncidenceSeries(
      inc([40, 50, 60], [0.001, NaN, 0.003], [0.0011, 0.0021, 0.0031]),
    );
    expect(out).toEqual([
      { age: 40, rate: 0.001, series: 'study' },
      { age: 40, rate: 0.0011, series: 'population' },
      { age: 50, rate: 0.0021, series: 'population' }, // no study point at 50
      { age: 60, rate: 0.003, series: 'study' },
      { age: 60, rate: 0.0031, series: 'population' },
    ]);
  });

  it('drops a NaN population rate but keeps the study point at that age', () => {
    const out = buildIncidenceSeries(inc([40, 50], [0.001, 0.002], [0.0011, NaN]));
    expect(out).toEqual([
      { age: 40, rate: 0.001, series: 'study' },
      { age: 40, rate: 0.0011, series: 'population' },
      { age: 50, rate: 0.002, series: 'study' }, // no population point at 50
    ]);
  });

  it('emits only study points when populationRate is null', () => {
    const out = buildIncidenceSeries(inc([40, 50], [0.001, 0.002], null));
    expect(out).toEqual([
      { age: 40, rate: 0.001, series: 'study' },
      { age: 50, rate: 0.002, series: 'study' },
    ]);
  });

  it('keeps true zero study rates (at-risk but event-free ages)', () => {
    const out = buildIncidenceSeries(inc([40, 41], [0, 0.002], null));
    expect(out).toEqual([
      { age: 40, rate: 0, series: 'study' },
      { age: 41, rate: 0.002, series: 'study' },
    ]);
  });

  it('skips a row with a non-finite age (both series)', () => {
    const out = buildIncidenceSeries(
      inc([40, NaN, 60], [0.001, 0.002, 0.003], [0.0011, 0.0021, 0.0031]),
    );
    expect(out).toEqual([
      { age: 40, rate: 0.001, series: 'study' },
      { age: 40, rate: 0.0011, series: 'population' },
      { age: 60, rate: 0.003, series: 'study' },
      { age: 60, rate: 0.0031, series: 'population' },
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(buildIncidenceSeries(inc([], [], null))).toEqual([]);
    expect(buildIncidenceSeries(inc([], [], []))).toEqual([]);
  });
});
