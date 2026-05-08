# Trash Cleaner

A program to delete trash emails based on keyword and label filters.

## Prerequisites

[Node.js & npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) (Node 18+)

## Installation 

### Via NPM
```bash
npm install -g trash-cleaner
```
### Via GitHub
```
git clone https://github.com/hasankhan/trash-cleaner
cd trash-cleaner
# If you want to try out the development version then 'git checkout dev'
npm install -g
```

## Gmail Configuration
1. Create a [Google Cloud Platform project with the API enabled](https://developers.google.com/workspace/guides/create-project).
2. Create [Authorization credentials for a desktop application](https://developers.google.com/workspace/guides/create-credentials) and download `gmail.credentials.json` file in the `config` directory.
3. Rename `keywords.json.sample` file in the `config` directory to `keywords.json` and update its contents.

## Outlook Configuration
1. Register an application with the [Microsoft identity platform](https://docs.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app).
2. Rename `outlook.credentials.json.sample` file in the `config` directory to `outlook.credentials.json` and update its contents.
3. Rename `keywords.json.sample` file in the `config` directory to `keywords.json` and update its contents.

## Get Started

Initialize the config directory with sample files:

```bash
trash-cleaner init [configDirPath]
```

This creates starter `keywords.json`, `gmail.credentials.json`, and `outlook.credentials.json` files. Edit them to match your setup (see configuration sections above).

To get the list of all parameters type `trash-cleaner -h`

```
Usage: trash-cleaner [options]

Options:
  -V, --version               output the version number
  -r, --reconfig              reconfigures the auth for a service
  -t, --dry-run               perform a dry-run cleanup without deleting the emails
  -d, --debug                 output extra debugging info
  -l, --launch                launch the auth url in the browser
  -q, --quiet                 suppress verbose output (for cron/scripts)
  -i, --interactive           preview matches and confirm before acting
  -f, --format <format>       output format: text or html (default: "text")
  -c, --configDirPath <path>  the path to config directory (default: "config")
  -s, --service <service>     the email service to use (choices: "gmail", "outlook", default: "gmail")
  -a, --account <name>        the account name for multi-account support (default: "default")
  -h, --help                  display help for command
```

## Commands

### `trash-cleaner init [configDirPath]`
Creates a config directory with sample configuration files.

### `trash-cleaner list-rules [configDirPath]`
Displays all active keyword rules and allowlist patterns.

### `trash-cleaner undo [configDirPath]`
Shows the last batch of processed emails and offers to restore them.

## Features

### Actions
Each keyword rule can specify an action: `delete` (default), `archive`, or `mark-as-read`.

```json
[
  { "value": "unsubscribe", "fields": "body", "labels": "promotions", "action": "archive" },
  { "value": "newsletter", "fields": "*", "labels": "*", "action": "mark-as-read" }
]
```

### Multi-Account Support
Run against different accounts using the `-a` flag:

```bash
trash-cleaner -s gmail -a work
trash-cleaner -s gmail -a personal
```

Each account stores its own credentials (e.g., `gmail.credentials.work.json`).

### Sender Allowlist
Create `config/allowlist.json` to protect specific senders from any actions:

```json
[
  "boss@company\\.com",
  ".*@important\\.org"
]
```

Patterns are case-insensitive regular expressions matched against the sender.

### Interactive Mode
Use `--interactive` to preview matched emails before taking action:

```bash
trash-cleaner --interactive
```

### Quiet Mode
Use `--quiet` for cron jobs or scripts — suppresses spinner and verbose output:

```bash
trash-cleaner --quiet
```

### HTML Reports
Generate an HTML report instead of console output:

```bash
trash-cleaner --format html
```

This creates a timestamped HTML file in the current directory.

### Retry Logic
API calls automatically retry with exponential backoff on transient failures (429, 5xx, network errors).

### Undo
After processing, actions are logged. Use `trash-cleaner undo` to restore the last batch:

```bash
trash-cleaner undo
```

## Scheduling

To run trash-cleaner automatically on a schedule:

### Linux/macOS (cron)

Run `crontab -e` and add a line. For example, to run every hour:

```
0 * * * * /usr/local/bin/trash-cleaner --quiet -c /path/to/config
```

### macOS (launchd)

Create `~/Library/LaunchAgents/com.trash-cleaner.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.trash-cleaner</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/trash-cleaner</string>
        <string>--quiet</string>
        <string>-c</string>
        <string>/path/to/config</string>
    </array>
    <key>StartInterval</key>
    <integer>3600</integer>
</dict>
</plist>
```

Load it with: `launchctl load ~/Library/LaunchAgents/com.trash-cleaner.plist`

### Windows (Task Scheduler)

```powershell
schtasks /create /tn "TrashCleaner" /tr "trash-cleaner --quiet -c C:\path\to\config" /sc hourly
```

## Development

```bash
npm install        # Install dependencies
npm test           # Run tests
npm run lint       # Run ESLint
npm run typecheck  # Run JSDoc type checking
npm run coverage   # Generate coverage report
```