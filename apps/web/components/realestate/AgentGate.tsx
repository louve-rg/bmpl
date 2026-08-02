import { EmptyState, ButtonLink } from '../ui';

/** Friendly state shown when the API returns 403 (not an approved real-estate agent). */
export function AgentGate() {
  return (
    <div className="mx-auto max-w-2xl">
      <EmptyState
        title="Agent access required"
        description="Manage listings on behalf of clients by applying for the Real-Estate Agent role. Once approved, your agent tools appear here."
        action={<ButtonLink href="/dashboard/roles">Apply to become an agent</ButtonLink>}
      />
    </div>
  );
}
