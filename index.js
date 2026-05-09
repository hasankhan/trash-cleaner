import { Cli } from './lib/cli.js';

const cli = new Cli();
const success = await cli.run(process.argv);
process.exitCode = success ? 0 : 1;
