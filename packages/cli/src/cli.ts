#!/usr/bin/env node

import chalk from 'chalk';
import { Command } from 'commander';
import { cleanCommand } from './commands/clean.js';
import { compactCommand } from './commands/compact.js';
import { indexCommand } from './commands/index.js';
import { mapCommand } from './commands/map.js';
import { mcpCommand } from './commands/mcp.js';
import { resetCommand } from './commands/reset.js';
import { searchCommand } from './commands/search.js';
import { setupCommand } from './commands/setup.js';
import { storageCommand } from './commands/storage.js';

// Injected at build time by tsup define
declare const __VERSION__: string;
const VERSION = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.0.0-dev';

const program = new Command();

program
  .name('dev')
  .description(chalk.cyan('🤖 Dev-Agent - Multi-agent code intelligence platform'))
  .version(VERSION);

// Register commands
program.addCommand(indexCommand);
program.addCommand(searchCommand);
program.addCommand(mapCommand);
program.addCommand(compactCommand);
program.addCommand(cleanCommand);
program.addCommand(storageCommand);
program.addCommand(mcpCommand);
program.addCommand(setupCommand);
program.addCommand(resetCommand);

// Show help if no command provided
if (process.argv.length === 2) {
  program.outputHelp();
}

program.parse(process.argv);
