'use client';

import { useEffect } from 'react';
import { jobsApi } from '../../lib/jobs';

/** Fires POST /job-seeker/recently-viewed/:id on mount. Fails silently for guests. */
export function RecentlyViewedTracker({ jobId }: { jobId: string }) {
  useEffect(() => {
    jobsApi.recordView(jobId).catch(() => {
      /* guests / errors: nothing to do */
    });
  }, [jobId]);
  return null;
}
