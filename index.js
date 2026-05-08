const { Cli } = require('./lib/cli');

(async function () {
    const cli = new Cli();
    const success = await cli.run(process.argv);
    process.exitCode = success ? 0 : 1;
})();
