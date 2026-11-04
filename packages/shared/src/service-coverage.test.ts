import { describe, expect, it } from 'vitest';
import { classifyDriverLegCoverage } from './service-coverage';

describe('classifyDriverLegCoverage', () => {
  it('is UNSUPPORTED when nobody has ever configured coverage, regardless of the (impossible) online count', () => {
    expect(classifyDriverLegCoverage({ configuredCount: 0, eligibleNowCount: 0 })).toEqual({ status: 'UNSUPPORTED' });
  });

  it('is TEMPORARILY_UNAVAILABLE when coverage is configured but nobody is online right now', () => {
    expect(classifyDriverLegCoverage({ configuredCount: 2, eligibleNowCount: 0 })).toEqual({ status: 'TEMPORARILY_UNAVAILABLE' });
  });

  it('is SUPPORTED when at least one configured driver is online right now', () => {
    expect(classifyDriverLegCoverage({ configuredCount: 2, eligibleNowCount: 1 })).toEqual({ status: 'SUPPORTED' });
  });

  it('never reports SUPPORTED off the online count alone — configured must be positive too', () => {
    // Not reachable in practice (eligibleNowCount is a subset of configuredCount),
    // but the rule itself must not depend on that invariant holding upstream.
    expect(classifyDriverLegCoverage({ configuredCount: 0, eligibleNowCount: 1 })).toEqual({ status: 'UNSUPPORTED' });
  });
});
