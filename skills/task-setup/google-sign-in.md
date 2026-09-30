# Google sign-in for gws

The plugin reaches Google Drive and Sheets through the `gws` CLI, which needs two things on each machine:

1. **An OAuth client**: a `client_secret.json` file from a Google Cloud project. It identifies the app that asks for access, and one client can serve a whole team.
2. **A sign-in**: `gws auth login` opens a browser, the user approves access, and `gws` stores the credentials encrypted on this machine.

`gws auth status` shows both: `client_config_exists` for the client, and `token_valid` and `user` for the sign-in.

Walk the user through one step at a time and wait for them to confirm each one. The user does these steps themselves, because they use their browser and their Google account.

## Step 1: get an OAuth client (once per machine)

The file goes here, and the `.config` folder may need creating:

- Windows: `C:\Users\<you>\.config\gws\client_secret.json`
- macOS and Linux: `~/.config/gws/client_secret.json`

Ask which situation fits, then follow that option.

### A. The team already has one (best for teams)

Someone on the team shares `client_secret.json` privately, for example in a direct message. Save it at the path above. Never commit it to the plugin's repository; the repository's `.gitignore` blocks it.

### B. Create one with the Google Cloud CLI

1. Install the Google Cloud CLI: https://cloud.google.com/sdk/docs/install
2. Run `gcloud auth login`.
3. Run `gws auth setup`. It creates a Cloud project, enables the APIs, creates the OAuth client and signs in, which also covers step 2.

### C. Create one by hand in the Cloud Console

1. Create a project, or pick one: https://console.cloud.google.com/projectcreate
2. Enable the **Google Drive API** and the **Google Sheets API** under **APIs & Services → Library**.
3. Set up the **OAuth consent screen**:
   - **Internal** if the Google account belongs to a company (Google Workspace). Everyone in the company can then sign in, with no test-user list and no "unverified app" warning.
   - Otherwise **External** in testing mode. Add each person's email under **Test users**.
4. Go to **Credentials → Create credentials → OAuth client ID**, choose **Desktop app**, and download the JSON. Save it at the path above as `client_secret.json`.

A team only needs to do option B or C once. After that, share the file as in option A.

## Step 2: sign in (again whenever it expires)

Run this in a terminal. In the Claude desktop app, use its Terminal panel; in the Claude CLI, type `! ` followed by the command.

```bash
gws auth login -s drive,sheets
```

- A browser opens. Pick the Google account and approve the access.
- If Google says "Google hasn't verified this app", click **Advanced**, then **Go to (app name)**. This is expected for a team's own OAuth client.
- `-s drive,sheets` asks only for what this plugin needs. To use the plugin's other gws skills, add their services, for example `-s drive,sheets,gmail,calendar`. Avoid `--full` with an unverified app, because Google blocks apps that ask for too many scopes.
- **Many company accounts must sign in again every 16 hours.** When the plugin reports that the sign-in expired, run the same command again.

## Troubleshooting

| What you see | Fix |
|---|---|
| "Access blocked" or error 403 during sign-in | The OAuth app is External and the account isn't a test user. Add it under **OAuth consent screen → Test users**, or switch the app to Internal |
| `redirect_uri_mismatch` | The OAuth client isn't a **Desktop app**. Create a new one of that type and replace `client_secret.json` |
| "API has not been used in project … or it is disabled" | Enable the Google Drive API and Google Sheets API in the project from `gws auth status` (`project_id`). Wait a minute, then try again |
| "Could not decrypt" in `gws auth status` | The credentials came from another machine or the keyring changed. Run `gws auth login -s drive,sheets` again |
| Too many scopes, or the consent screen fails | Sign in with `-s drive,sheets` instead of `--full` |
