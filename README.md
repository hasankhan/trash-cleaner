# Trash Cleaner

A program to delete trash emails based on keyword and label filters.

## Prerequisites

[Node.js & npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm)

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
  -c, --configDirPath <path>  the path to config directory (default: "config")
  -s, --service <service>     the email service to use (choices: "gmail", "outlook", default: "gmail")
  -a, --account <name>        the account name for multi-account support (default: "default")
  -h, --help                  display help for command
```

## Scheduling

To run trash-cleaner automatically on a schedule:

### Linux/macOS (cron)

Run `crontab -e` and add a line. For example, to run every hour:

```
0 * * * * /usr/local/bin/trash-cleaner -c /path/to/config
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
schtasks /create /tn "TrashCleaner" /tr "trash-cleaner -c C:\path\to\config" /sc hourly
```