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
  -h, --help                  display help for command
```