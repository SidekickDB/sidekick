// SidekickDB: the docs are served by the self-hosted dashboard, where
// upstream's marketing nav (Instant's logo, site links, GitHub) would present
// the product as Instant. Self-hosted, the header is the plain text
// "SidekickDB" linking to the dashboard, plus the same mobile menu.
import { useEffect, useState } from 'react';
import NextLink from 'next/link';
import clsx from 'clsx';
import { Bars3Icon, XMarkIcon } from '@heroicons/react/24/solid';
import { BareNav } from '@/components/marketingUi';
import { isSelfHosted } from '@/lib/config';

function TextLogo() {
  return (
    <NextLink href="/dash" className="font-mono text-base">
      SidekickDB
    </NextLink>
  );
}

export function DocsHeaderNav({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    if (!isSelfHosted) return;
    document.body.style.overflow = isOpen ? 'hidden' : 'auto';
  }, [isOpen]);

  if (!isSelfHosted) return <BareNav>{children}</BareNav>;

  return (
    <div className="flex flex-row items-center justify-between gap-4 text-lg md:text-base">
      <TextLogo />
      <button className="md:hidden" onClick={() => setIsOpen(true)}>
        <Bars3Icon height="1em" />
      </button>
      <div
        className={clsx(
          'fixed inset-0 z-40 flex-col items-start gap-6 overflow-y-scroll bg-white/90 px-8 py-4 backdrop-blur-md md:hidden',
          isOpen ? 'flex' : 'hidden',
        )}
        onClick={() => setIsOpen(false)}
      >
        <div className="flex justify-between self-stretch">
          <TextLogo />
          <button className="z-50 mt-0.5" onClick={() => setIsOpen(false)}>
            <XMarkIcon height="1em" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
