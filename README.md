# Gmail Cleanup

A program to delete trash emails based on keyword and label filters.

## Setup

1. Install [Node.js & npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm)
2. Create a [Google Cloud Platform project with the API enabled](https://developers.google.com/workspace/guides/create-project).
3. Create [Authorization credentials for a desktop application](https://developers.google.com/workspace/guides/create-credentials) and download `credentials.json` file in the project directory.
4. Run `npm install` in the project directory.
5. Rename `keywords.json.sample` file to `keywords.json` and update its contents.
6. Run `node .`

## Google Cloud Setup

In addition to the steps above, to run this script in Google Cloud automatically at regular intervals, you can do the following:

1. Create a [HTTP triggered Cloud Function](https://cloud.google.com/functions/docs/deploying/console).

2. Copy source and config files to the Cloud Function.

3. Create a [Cloud Scheduler Job with Authentication](https://cloud.google.com/scheduler/docs/http-target-auth#creating_a_scheduler_job_with_authentication).

4. Add [Cloud Functions Invoker](https://cloud.google.com/iam/docs/understanding-roles#cloudfunctions.invoker) role to the Service Account created for Cloud Function.