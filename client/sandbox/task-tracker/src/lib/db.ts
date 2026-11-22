import { init } from '@sidekickdb/react';
import schema from '../instant.schema';
import config from '../../config';

export const db = init({
  schema,
  useDateObjects: true,
  // devtool: false,
  ...config,
});
