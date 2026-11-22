// Docs: https://www.instantdb.com/docs/permissions

import { type InstantRules } from '@sidekickdb/react';

const rules = {
  attrs: {
    allow: {
      create: 'false',
    },
  },
} satisfies InstantRules;

export default rules;
