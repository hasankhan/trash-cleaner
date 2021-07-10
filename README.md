# Trash Cleaner

A program to delete trash emails based on keyword and label filters.

## Setup

1. Install [Node.js & npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm)
2. Create a [Google Cloud Platform project with the API enabled](https://developers.google.com/workspace/guides/create-project).
3. Create [Authorization credentials for a desktop application](https://developers.google.com/workspace/guides/create-credentials) and download `credentials.json` file in the project directory.
4. Run `npm install` in the project directory.
5. Rename `keywords.json.sample` file to `keywords.json` and update its contents.
6. Run `node .`

## Options

```
Usage: trash-cleaner [options]

Options:
  -V, --version               output the version number
  -d, --debug                 output extra debugging info
  -c, --configDirPath <path>  the path to config directory (default: "config")
  -s, --service <service>     the email service to use (choices: "gmail", "outlook", default: "gmail")
  -h, --help                  display help for command
```