// SidekickDB: the /intern pages are served by the self-hosted dashboard, where
// upstream's marketing nav and footer (Instant's logo, site links, Discord)
// would present the product as Instant. Self-hosted, the nav is the plain text
// "SidekickDB" linking to the dashboard and there is no footer.
import NextLink from 'next/link';
import { LegacyNav } from '@/components/marketingUi';
import { Footer } from '@/components/new-landing/Footer';
import { isSelfHosted } from '@/lib/config';

export function InternNav() {
  if (!isSelfHosted) return <LegacyNav />;
  return (
    <div className="border-b border-b-gray-200 py-4">
      <div className="landing-width mx-auto">
        <NextLink href="/dash" className="font-mono text-sm">
          SidekickDB
        </NextLink>
      </div>
    </div>
  );
}

export function InternFooter() {
  return isSelfHosted ? null : <Footer />;
}
