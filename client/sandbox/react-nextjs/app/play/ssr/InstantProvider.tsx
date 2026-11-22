'use client';

import { User } from '@sidekickdb/react';
import { InstantSuspenseProvider } from '@sidekickdb/react/nextjs';
import { db } from './db';

export const InstantProvider = ({
  children,
  user,
}: {
  children: React.ReactNode;
  user: User | null;
}) => {
  return (
    <InstantSuspenseProvider user={user} db={db}>
      {children}
    </InstantSuspenseProvider>
  );
};
