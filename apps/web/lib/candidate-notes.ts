/**
 * The label on every employer note field the CANDIDATE will read — BMPL-145.
 *
 * Two employer inputs travel to the applicant: the status-change note (written
 * into the transition event, rendered in the applicant's timeline) and the
 * interview note (serialized into the applicant's view of the interview,
 * applications.service.ts:268). The ruling: both STAY candidate-visible and
 * the label says so — the private channel already exists as the 'Private
 * notes' card, so an employer with candid text has somewhere to put it, and a
 * second private-looking field would be the confusing option.
 *
 * Stated once here and imported by both form fields, so the two labels can
 * never drift apart — and the test pins that the sentence names the
 * candidate, because a bare 'Notes (optional)' on a candidate-visible field
 * is how candid employer text leaks.
 */
export const CANDIDATE_VISIBLE_NOTE_LABEL = 'Note to candidate (optional)';
