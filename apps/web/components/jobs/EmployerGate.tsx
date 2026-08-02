import { EmptyState, ButtonLink } from '../ui';

/** Friendly state shown when the API returns 403 (not an approved employer). */
export function EmployerGate() {
  return (
    <div className="mx-auto max-w-2xl">
      <EmptyState
        title="Employer access required"
        description="Post jobs and manage applicants on Belize Connect by applying for the Employer role. Once approved, your employer tools appear here."
        action={<ButtonLink href="/dashboard/roles">Apply to become an employer</ButtonLink>}
      />
    </div>
  );
}
