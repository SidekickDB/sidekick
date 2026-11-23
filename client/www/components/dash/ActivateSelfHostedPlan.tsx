import { useContext, useState } from 'react';
import { useSWRConfig } from 'swr';
import { Button } from '@/components/ui';
import { useFetchedDash } from '@/components/dash/MainDashLayout';
import { friendlyErrorMessage } from '@/lib/auth';
import config from '@/lib/config';
import { TokenContext } from '@/lib/contexts';
import { messageFromInstantError } from '@/lib/errors';
import { jsonFetch } from '@/lib/fetch';
import { errorToast } from '@/lib/toast';
import { InstantIssue } from '@/lib/types';

// Self-hosted dashboards hide Billing, so the plan included with the instance
// is activated from where it is needed instead.
export function ActivateSelfHostedPlanButton({
  target,
}: {
  target: { type: 'app'; appId: string } | { type: 'org'; orgId: string };
}) {
  const token = useContext(TokenContext);
  const fetchedDash = useFetchedDash();
  const { mutate } = useSWRConfig();
  const [isActivating, setIsActivating] = useState(false);
  const planName = target.type === 'app' ? 'Pro' : 'Startup';
  const url =
    target.type === 'app'
      ? `${config.apiURI}/dash/apps/${target.appId}/self_hosted_subscription`
      : `${config.apiURI}/dash/orgs/${target.orgId}/self_hosted_subscription`;

  const onActivate = async () => {
    setIsActivating(true);
    try {
      await jsonFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      await Promise.all([
        fetchedDash.refetch(),
        // useOrgPaid caches the org's plan under this key.
        target.type === 'org' ? mutate(`${target.orgId}-is-paid`) : null,
      ]);
    } catch (err) {
      const message =
        messageFromInstantError(err as InstantIssue) ||
        `Failed to activate the included ${planName} plan.`;
      errorToast(friendlyErrorMessage('dash-billing', message));
    } finally {
      setIsActivating(false);
    }
  };

  return (
    <Button
      variant="primary"
      size={target.type === 'org' ? 'mini' : undefined}
      loading={isActivating}
      onClick={onActivate}
    >
      Activate {planName} for free
    </Button>
  );
}
