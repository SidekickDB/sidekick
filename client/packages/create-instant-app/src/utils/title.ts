import { intro } from '@clack/prompts';
import chalk from 'chalk';

// SidekickDB: a plain-text title. Upstream draws its logo and name here.
export const renderTitle = () => {
  intro(chalk.bold(' SidekickDB '));
};
