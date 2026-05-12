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

## IMAP Configuration (Recommended)

The simplest way to get started. Works with any email provider.

### Option 1: Secure Login (Recommended)

Store credentials securely in your OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service):

```bash
trash-cleaner init          # Create config directory with sample files
trash-cleaner login         # Prompts for IMAP credentials, saves to OS keychain
```

For other services:
```bash
trash-cleaner login -s gmail
trash-cleaner login -s outlook
```

To remove stored credentials:
```bash
trash-cleaner logout        # Remove IMAP credentials from keychain
trash-cleaner logout -s gmail
```

### Option 2: File-based Configuration

If your system doesn't have a keychain, credentials fall back to JSON files:

1. Run `trash-cleaner init` to create sample config files
2. Edit `config/imap.credentials.json` with your email settings:
   ```json
   {
       "host": "imap.gmail.com",
       "port": 993,
       "user": "your-email@gmail.com",
       "password": "your-app-password"
   }
   ```

### App Passwords

- **Gmail**: [Create an App Password](https://myaccount.google.com/apppasswords) (requires 2FA)
- **Outlook**: Use your regular password or an app password
- **Yahoo**: Account Security → Generate app password

Common IMAP servers:
| Provider | Host | Port |
|----------|------|------|
| Gmail | imap.gmail.com | 993 |
| Outlook/Hotmail | outlook.office365.com | 993 |
| Yahoo | imap.mail.yahoo.com | 993 |
| iCloud | imap.mail.me.com | 993 |

> **Note**: Some features (undo) are only available with the Gmail/Outlook API backends. Use `--service gmail` or `--service outlook` for those.

## Gmail API Configuration (Advanced)
1. Create a [Google Cloud Platform project with the API enabled](https://developers.google.com/workspace/guides/create-project).
2. Create [Authorization credentials for a desktop application](https://developers.google.com/workspace/guides/create-credentials) and download `gmail.credentials.json` file in the `config` directory.
3. Rename `keywords.json.sample` file in the `config` directory to `keywords.json` and update its contents.

## Outlook API Configuration (Advanced)
1. Register an application with the [Microsoft identity platform](https://docs.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app).
2. Rename `outlook.credentials.json.sample` file in the `config` directory to `outlook.credentials.json` and update its contents.
3. Rename `keywords.json.sample` file in the `config` directory to `keywords.json` and update its contents.

## Get Started

Initialize the config directory with sample files:

```bash
trash-cleaner init [configDirPath]
```

This creates starter `keywords.json`, `imap.credentials.json`, `gmail.credentials.json`, and `outlook.credentials.json` files. Edit them to match your setup (see configuration sections above).

## Configuring Rules

Rules live in `keywords.json` in your config directory (`~/.config/trash-cleaner/` by default). The file contains a JSON array of rule objects. Each rule tells trash-cleaner which emails to match and what to do with them.

### Rule Fields

| Field | Required | Description |
|-------|----------|-------------|
| `value` | Yes | **Keyword rules**: A regex pattern to match. **LLM rules**: A natural language description. |
| `fields` | No | Comma-separated email fields to search: `from`, `subject`, `snippet`, `body`, or `*` for all. Default: `*` |
| `labels` | No | Comma-separated folder/label names to scope the rule: `inbox`, `spam`, `trash`, `junk email`, or `*` for all. Default: `*` |
| `action` | No | What to do with matches: `delete`, `archive`, or `mark-as-read`. Default: `delete` |
| `type` | No | Rule type: `keyword` (regex, default) or `llm` (semantic similarity). |

### Keyword Rules (Regex)

Keyword rules use regular expressions to match email content. They are fast and precise.

```json
[
    { "value": "casino", "fields": "*", "labels": "*" },
    { "value": "credit|loan", "fields": "subject", "labels": "spam,junk email" },
    { "value": "newsletter", "fields": "subject", "labels": "inbox", "action": "archive" },
    { "value": "notification", "fields": "subject", "labels": "inbox", "action": "mark-as-read" }
]
```

- **Delete all trash**: `{ "value": ".", "fields": "*", "labels": "trash,deleted items" }` — the `.` regex matches any character, so this deletes everything in the trash folder.
- **Match multiple words**: `{ "value": "lucky|winner|prize", "fields": "body", "labels": "spam" }` — uses regex `|` (OR) to match any of the words.
- **Match emoji in subject**: `{ "value": "[\\u{1F600}-\\u{1F64F}]", "fields": "subject", "labels": "*" }` — uses Unicode character ranges to match emoji.
- Matching is **case-insensitive** and **diacritic-insensitive** (e.g., "café" matches "cafe").

### LLM Rules (Semantic Similarity)

LLM rules use a local AI model to match emails by meaning rather than exact text. Write a natural language description of what you want to match. The model (~23MB, downloaded on first use) compares your description against each email's subject, snippet, and sender.

```json
[
    { "value": "marketing or promotional email", "labels": "*", "type": "llm", "action": "archive" },
    { "value": "someone selling me something", "labels": "inbox", "type": "llm" }
]
```

- The `value` is a **description**, not a regex — write it like you'd describe the email to someone.
- LLM rules are slower than keyword rules (~200ms per email) but can catch things regex can't.
- The model runs **locally** on your device — no data is sent to any server.
- The model is only downloaded if you have at least one LLM rule configured.

### Scoping Rules with Labels and Fields

Use `labels` to limit which folders a rule applies to:
- `"labels": "inbox"` — only match emails in your inbox
- `"labels": "spam,junk email"` — only match emails in spam/junk folders
- `"labels": "trash,deleted items"` — only match emails in trash
- `"labels": "*"` — match emails in any folder

Use `fields` to limit which parts of an email are searched (keyword rules only):
- `"fields": "subject"` — only search the subject line
- `"fields": "subject,body"` — search subject and body
- `"fields": "*"` — search all fields (from, subject, snippet, body)

### Example Configuration

```json
[
    { "value": ".", "fields": "*", "labels": "trash,deleted items" },
    { "value": "casino|lottery|winner", "fields": "*", "labels": "spam,junk email" },
    { "value": "unsubscribe", "fields": "body", "labels": "inbox", "action": "archive" },
    { "value": "notification", "fields": "subject", "labels": "inbox", "action": "mark-as-read" },
    { "value": "marketing or promotional email", "labels": "inbox", "type": "llm", "action": "archive" }
]
```

Rules are evaluated in order — the **first matching rule wins**. Place more specific rules before general ones.

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
  -m, --min-age <days>        only process emails older than N days
  -c, --configDirPath <path>  the path to config directory (default: "config")
  -s, --service <service>     the email service to use (choices: "imap", "gmail", "outlook", default: "imap")
  -a, --account <name>        the account name for multi-account support (default: "default")
  -h, --help                  display help for command
```

## Commands

### `trash-cleaner init [configDirPath]`
Creates a config directory with sample configuration files.

### `trash-cleaner list-rules [configDirPath]`
Displays all active keyword rules and allowlist patterns.

### `trash-cleaner validate [configDirPath]`
Validates configuration files and reports any issues.

### `trash-cleaner undo [configDirPath]`
Shows the last batch of processed emails and offers to restore them.

### `trash-cleaner login [-s service] [-a account]`
Prompts for credentials and saves them securely in the OS keychain. Supports `--service imap` (default), `gmail`, or `outlook`.

### `trash-cleaner logout [-s service] [-a account]`
Removes stored credentials from the OS keychain.

## Features

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

### Email Age Filter
Only process emails older than a certain number of days:

```bash
trash-cleaner --min-age 7
```

### Config Validation
Check your configuration files for errors before running:

```bash
trash-cleaner validate
```

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

## Releasing

Releases are automated via GitHub Actions. To publish a new version:

```bash
npm version patch   # or minor, or major
git push --follow-tags
```

This triggers the publish workflow which runs tests and publishes to npm.
Requires `NPM_TOKEN` secret configured in the repository settings.