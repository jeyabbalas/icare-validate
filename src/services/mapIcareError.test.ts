import { describe, it, expect } from 'vitest';
import { mapIcareError } from './mapIcareError';

describe('mapIcareError', () => {
  it('maps a Mode-B KeyError on a canonical column to a friendly naming message', () => {
    expect(mapIcareError(new Error("KeyError: 'risk_estimates'"))).toMatch(
      /risk_estimates[\s\S]*linear_predictors/,
    );
    expect(mapIcareError("Traceback (most recent call last):\nKeyError: 'linear_predictors'\n")).toMatch(
      /named exactly/i,
    );
  });

  it('does not misfire on an unrelated KeyError', () => {
    const raw = "KeyError: 'some_other_column'";
    expect(mapIcareError(new Error(raw))).toBe(raw);
  });

  it('maps a missing-runtime-asset error to a vendor hint', () => {
    expect(mapIcareError(new Error('offline browser boot requires an explicit indexURL'))).toMatch(
      /npm run vendor/,
    );
  });

  it('falls back to the raw message, or a generic one when empty', () => {
    expect(mapIcareError(new Error('boom'))).toBe('boom');
    expect(mapIcareError('')).toBe('Unknown error while running the iCARE engine.');
  });
});
