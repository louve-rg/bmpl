'use client';

import { PageHeader } from '../../../../components/ui';
import { OperatorBreadcrumb, OperatorShell } from '../../../../components/passenger-operator/data';
import { OperatorProfileForm } from '../../../../components/passenger-operator/ProfileForm';

export default function OperatorProfilePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <OperatorBreadcrumb current="Business Profile" />
      <PageHeader title="Business Profile" description="Your company details, contact information and operating licence." />
      {/* Useful before a profile exists — this form is how one is created. */}
      <OperatorShell requiresProfile={false}>
        {(data, reload) => <OperatorProfileForm profile={data.profile} onDone={reload} />}
      </OperatorShell>
    </div>
  );
}
