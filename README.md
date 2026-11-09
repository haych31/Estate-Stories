# Estate Stories Bot + Website

One Node.js app that runs the Discord bot **and** the website/dashboard.

**Bot commands:** `/ticketpanel`, `/verifypanel`, `/embed`, `/announce`, `/optout`, `/optin`, `/ping`
**Website:** public verify page + admin dashboard (verified users, linked servers, send embeds, announcements, tickets, settings).

---
## Step 1: Create the bot in Discord
1. Go to https://discord.com/developers/applications and click **New Application** (name it Estate Stories).
2. **General Information**: copy the **Application ID** (this is `CLIENT_ID`).
3. **OAuth2**: click **Reset Secret**, copy it (this is `CLIENT_SECRET`).
4. **Bot** tab: click **Reset Token**, copy it (this is `DISCORD_TOKEN`). Leave the Privileged Intents OFF, they are not needed.
5. Invite the bot to your server. Use this link (replace YOUR_CLIENT_ID):
   `https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot%20applications.commands&permissions=268520465`
   (Manage Roles, Manage Channels, View Channels, Send Messages, Read History, Embed Links, Create Invite.) Use the same link to add the bot to any other server you want to link.
6. In Discord, drag the bot's role **above** the verified role in Server Settings, Roles. Otherwise it cannot hand the role out.
7. Turn on Developer Mode (Settings, Advanced) so you can Copy ID. Copy your **server ID** (`GUILD_ID`) and **your user ID** (`ADMIN_IDS`).

## Step 2: Put the code on GitHub
1. Make a free account at github.com and create a **private** repository.
2. Upload every file from this folder (not `node_modules`, not `.env`).

## Step 3: Deploy on Railway
1. Go to https://railway.com, log in with GitHub, click **New Project, Deploy from GitHub repo**, pick your repo.
2. Open the service, **Settings, Networking, Generate Domain**. Copy the URL (like `https://estate-stories.up.railway.app`).
3. **Variables** tab, add these:

| Variable | Value |
|---|---|
| DISCORD_TOKEN | from step 1 |
| CLIENT_ID | from step 1 |
| CLIENT_SECRET | from step 1 |
| GUILD_ID | your server ID |
| ADMIN_IDS | your Discord user ID (comma separate for more) |
| BASE_URL | your Railway URL, no slash on the end |
| SESSION_SECRET | any long random text |
| NODE_ENV | production |
| DB_PATH | /data/estate.db |

4. **Add a Volume** (right-click the service canvas, Volume) and mount it at `/data`. Without this, your verified users are wiped on every redeploy.
5. Back in the Discord Developer Portal, **OAuth2, Redirects, Add Redirect**: `YOUR_BASE_URL/callback` (e.g. `https://estate-stories.up.railway.app/callback`). Save.
6. Railway redeploys. Check **Deployments, View Logs** for "Bot online" and "Slash commands registered".

## Step 4: Set it up in Discord
1. Visit `YOUR_BASE_URL/login`, log in, open **Settings** and paste the verified role ID, support role ID, ticket category ID and log channel ID.
2. In your verify channel run `/verifypanel`. In your support channel run `/ticketpanel`.
3. In **Servers**, add any other server (ID and name). Turn on **Auto-join** if verified users should be added automatically.

## Test locally (optional)
Copy `.env.example` to `.env`, fill it in, add `http://localhost:3000/callback` as a redirect, run `npm install` then `npm start`.

---
## Keep your bot (and you) safe
- **Mass-DMing everyone is not built in on purpose.** DMing members who never opted in is spam under Discord's rules and is one of the fastest ways to get a bot and your account banned. `/announce` only messages people who verified, skips anyone who used `/optout`, and is rate limited.
- **Verification states what happens.** The verify page tells people they will be added to linked servers and get announcements. Keep that wording. Only link servers you own or run.
- **Never share** your bot token or client secret. If leaked, reset them in the Developer Portal.
- **Verification tokens** are stored in your database, so keep the repo private and the Railway project locked down. Users can revoke access any time in Discord, Authorized Apps.
- Don't use the bot to add people to servers that are not clearly part of your community, and respect Discord's Developer Terms and Community Guidelines.
- Discord's rules change. Re-read https://discord.com/developers/docs/policies-and-agreements/developer-policy occasionally.

## Ideas to add later
Whitelist applications, a staff-only ticket transcript, server status (players online) via your FiveM `players.json`, welcome messages, giveaways, role-select buttons.
