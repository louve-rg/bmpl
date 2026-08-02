'use client';

import Link from 'next/link';
import { EmployerJobForm } from '../../../../../components/jobs/EmployerJobForm';
import { PageHeader } from '../../../../../components/ui';

export default function NewJobPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/dashboard/employer/jobs" className="text-sm font-medium text-belize-blue hover:underline">
        ← Job Listings
      </Link>
      <div className="mt-2">
        <PageHeader eyebrow="Employer" title="New job" />
      </div>
      <EmployerJobForm />
    </div>
  );
}
