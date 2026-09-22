import { describe, expect, it } from 'vitest';
import { interviewActions } from './interview-actions';

describe('interviewActions', () => {
  it('offers all three verbs while the interview is live', () => {
    expect(interviewActions('SCHEDULED')).toEqual(['complete', 'cancel', 'reschedule']);
    expect(interviewActions('RESCHEDULED')).toEqual(['complete', 'cancel', 'reschedule']);
  });

  it('offers nothing on a finished interview', () => {
    expect(interviewActions('COMPLETED')).toEqual([]);
    expect(interviewActions('CANCELLED')).toEqual([]);
  });

  it('fails closed on an unknown status a future API might send', () => {
    expect(interviewActions('NO_SHOW')).toEqual([]);
    expect(interviewActions('')).toEqual([]);
  });
});
