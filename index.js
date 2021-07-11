const { Cli } = require('./lib/cli');

(async function () {
    let cli = new Cli();
    let success = await cli.run(process.argv);
    process.exitCode = success ? 0 : 1;
})();
