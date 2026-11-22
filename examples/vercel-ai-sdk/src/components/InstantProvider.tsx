'use client';
import { db } from '@/lib/db';
import { type User } from '@sidekickdb/react';
import { InstantSuspenseProvider } from '@sidekickdb/react/nextjs';
import React from 'react';

export const InstantProvider = ({
  children,
  user,
}: {
  children: React.ReactNode;
  user: User | null;
}) => (
  <InstantSuspenseProvider user={user} db={db}>
    {children}
  </InstantSuspenseProvider>
);
