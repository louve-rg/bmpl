import { describe, expect, it } from 'vitest';
import { reportedCommit } from './build-commit';

describe('reportedCommit', () => {
  it('reports an unknown build as null, never as a placeholder value', () => {
    // The whole point of BMPL-67: an empty answer is not a negative answer.
    // A stale deploy hid twice because "no commit" was conflated with a value
    // ('dev', ''), so deploy-status could not tell "unknown" from "known".
    expect(reportedCommit(undefined)).toBeNull();
    expect(reportedCommit(null)).toBeNull();
    expect(reportedCommit('')).toBeNull();
    expect(reportedCommit('   ')).toBeNull();
  });

  it('shortens a full sha to 7 characters, matching /api/health', () => {
    expect(reportedCommit('90c49dbf00112233445566778899aabbccddeeff')).toBe('90c49db');
  });

  it('passes an already-short sha through unchanged', () => {
    expect(reportedCommit('90c49db')).toBe('90c49db');
    expect(reportedCommit('dff8d')).toBe('dff8d');
  });
});
