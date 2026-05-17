# Render feedback backend — setup walkthrough

This folder contains everything needed to host the feedback webhook + dashboard on Render. **Free, commercial use allowed, no credit card required.**

## What's in this folder

| File | Purpose |
|---|---|
| `server.js` | The web server that receives feedback events and serves the dashboard |
| `package.json` | List of code libraries the server needs |
| `render.yaml` | "Blueprint" — tells Render to set up the server + database in one click |
| `public/feedback/index.html` | The dashboard you open in a browser |
| `.gitignore` | Files to skip when uploading to GitHub |

## Setup — step by step

The flow has two parts: **Part A — put the code on GitHub**, then **Part B — point Render at the GitHub repo**.

If you've never used GitHub, the first part takes ~10 min. Render itself is ~5 min after that.

---

### Part A: Put the code on GitHub

#### A1. Sign up for GitHub

1. Go to [github.com/signup](https://github.com/signup)
2. Email: `michaelpl@etoro.com`
3. Pick a password
4. Pick a username (e.g. `michaelpl-etoro`)
5. Verify the email link they send you

If GitHub redirects you to an eToro-managed login (some companies enforce this), use whatever GitHub account you already have through eToro.

#### A2. Create a new repository

1. Top-right corner of github.com → **+** icon → **New repository**
2. Repository name: `etoro-ux-feedback`
3. Description: `Feedback backend for the UX Writing Agent Figma plugin`
4. **Public** (must be public so Render can read it — you'll only push code, no secrets, the dashboard password lives in Render's settings)
5. Leave everything else default
6. Click **Create repository**

#### A3. Upload the code

You'll land on an empty repo page with a message like "Quick setup". Look for a link that says **"uploading an existing file"** (under the heading "…or upload existing files").

1. Click that link
2. Open a file-explorer window on your machine and navigate to:
   `C:\Users\michaelpl\Desktop\eToro UX Agent\figma-copy-assistant\pilot\feedback-backend-render\`
3. Select ALL the files and folders inside (Ctrl+A) — but NOT the `feedback-backend-render` folder itself, just its contents
4. Drag them into the GitHub upload zone
5. Wait for them to upload
6. At the bottom of the page: commit message = `initial`, then click **Commit changes**

Your repo URL is now: `https://github.com/YOUR-USERNAME/etoro-ux-feedback`. Write it down.

---

### Part B: Deploy to Render

#### B1. Sign up for Render

1. Go to [render.com](https://render.com) → **Get Started**
2. Pick **Sign up with email** (avoid GitHub SSO for now — keeps it simple)
3. Email: `michaelpl@etoro.com`, set a password
4. Verify the email they send

If Render insists on connecting via GitHub: pick **Continue with GitHub** instead and authorize it.

#### B2. Connect your GitHub repo

1. Render dashboard → top-right → **New +** → **Blueprint**
2. **Connect a repository** → choose **Public Git repository**
3. Paste your GitHub repo URL: `https://github.com/YOUR-USERNAME/etoro-ux-feedback`
4. Click **Connect**

Render will read the `render.yaml` file and show you what it plans to create: one web service and one database.

#### B3. Provide the dashboard password

Render will prompt for the value of `FEEDBACK_READ_TOKEN`. This is the password for viewing your dashboard.

To generate one:
1. Open your browser dev tools (press **F12**)
2. Click the **Console** tab
3. Type: `crypto.randomUUID()` and press Enter
4. Copy the output (e.g. `a4f2b7c9-1234-5678-90ab-cdef12345678`)
5. **Save it somewhere safe** — you'll need to paste it into the dashboard

Paste the value into Render's prompt, then click **Apply**.

#### B4. Wait for the deploy

Render shows you a build log. First deploy takes ~3–5 minutes (it has to install Node, install dependencies, start the server, create the database).

When the web service status is **Live** (green dot), you're done.

Your URL is: `https://etoro-ux-feedback.onrender.com`

If Render's name picker took `etoro-ux-feedback` already and you got something like `etoro-ux-feedback-xyz`, **tell me the actual URL** so I can update the plugin to match.

---

### Part C: Test it works

#### C1. Try the endpoint

In a browser, open: `https://etoro-ux-feedback.onrender.com/`

You should see: "UX Writing Agent feedback backend. Dashboard at /feedback."

(First load might take 30–60 seconds — Render's free tier "sleeps" the server when not in use and wakes it on the next request.)

#### C2. Open the dashboard

Go to: `https://etoro-ux-feedback.onrender.com/feedback`

Paste your `FEEDBACK_READ_TOKEN` from step B3. You should see an empty dashboard ("No events match these filters").

#### C3. Republish the plugin

Same as before:

1. Figma → **Plugins → Development → Manage plugins in development**
2. Find "Copy Assistant" → **…** → **Publish new version**
3. Release note: "feedback backend on Render"
4. **Publish**

Click 👍 on a finding in the republished plugin. Refresh the dashboard. The event should appear within a few seconds.

---

## Important reminders

- **Save your data:** Render's free database is deleted 90 days after creation. To keep your data forever, click **Export CSV** on the dashboard once a week (or before that 90-day mark) and save the file to OneDrive.
- **First request is slow:** Render's free tier puts the server to sleep after 15 minutes of no activity. The next request wakes it up, which takes 30–60 seconds. After that the server stays warm until the next idle period. This is fine for feedback events (the plugin fires and forgets) but means the dashboard might be slow on the first open of the day.
- **Updating the code later:** Push new code to your GitHub repo and Render auto-deploys within ~3 minutes. No manual upload step.

## When IT comes through

If IT approves Power Automate or Cloudflare, this Render setup stays useful as a backup. To switch destinations, update `FEEDBACK_WEBHOOK_URL` in the root `ui.html` and the `allowedDomains` in `manifest.json`, then republish the plugin. The Render version keeps running until you delete it from the Render dashboard.
