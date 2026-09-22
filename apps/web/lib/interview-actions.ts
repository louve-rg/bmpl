/**
 * Which controls an interview offers the employer — BMPL-150.
 *
 * The API (PATCH /employer/interviews/:id) accepts any partial update and
 * derives RESCHEDULED when a new time arrives without a status; it imposes
 * no transition map. What belongs here is only the UI truth that a finished
 * interview is finished: offering "Cancel" on a CANCELLED interview or
 * "Complete" on a COMPLETED one would be noise, not capability. Both live
 * states (SCHEDULED and RESCHEDULED) offer all three verbs; both terminal
 * states offer none. The server stays the authority on everything else and
 * its refusals are shown verbatim.
 */

export type InterviewAction = 'complete' | 'cancel' | 'reschedule';

export function interviewActions(status: string): InterviewAction[] {
  return status === 'SCHEDULED' || status === 'RESCHEDULED'
    ? ['complete', 'cancel', 'reschedule']
    : [];
}
