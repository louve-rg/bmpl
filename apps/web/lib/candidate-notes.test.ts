import { describe, expect, it } from 'vitest';
import { CANDIDATE_VISIBLE_NOTE_LABEL } from './candidate-notes';

describe('CANDIDATE_VISIBLE_NOTE_LABEL', () => {
  it('is the exact shipped sentence', () => {
    expect(CANDIDATE_VISIBLE_NOTE_LABEL).toBe('Note to candidate (optional)');
  });

  it('names the candidate — a label that stops doing so re-opens the leak', () => {
    // The field it labels is serialized into the applicant's own view; an
    // employer must never be invited to write candid text into it by a
    // label that reads private ('Notes (optional)' was exactly that).
    expect(CANDIDATE_VISIBLE_NOTE_LABEL.toLowerCase()).toContain('candidate');
  });
});
