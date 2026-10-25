# Discord account linking

Players link exactly one Discord account to exactly one character. The TNR Discord server
gates its channels behind a **Verified Ninja** role that Discord grants through
[Linked Roles](https://discord.com/developers/docs/tutorials/configuring-app-metadata-for-linked-roles):
the role requires the application's `linked` metadata, which the game pushes when a player
links. A bot token (REST only, no gateway) sets each member's nickname to the character name,
manages village roles and mirrors indefinite in-game sanctions as server bans.

Code: `app/src/server/utils/discord/` (config, REST client, rules, links, sync),
`app/src/app/api/discord/{authorize,callback}`, `app/src/app/api/hourly-discord-sync`,
the `discord` tRPC router, `/discord/link`, the Discord section in profile settings and the
staff page `/reports/discord`.

## Rules

- Unique keys on `DiscordLink.userId` and `DiscordLink.discordId`: one active link per
  character and per Discord account. A Discord account linked elsewhere shows a masked name.
- Discord accounts younger than `DISCORD_MIN_ACCOUNT_AGE_DAYS` (30) are refused, measured
  from the snowflake id.
- After an unlink, neither the character nor the Discord account can link to a *different*
  partner for `DISCORD_UNLINK_COOLDOWN_DAYS` (30). Relinking the same pair is allowed. Staff
  can waive the cooldown when force-unlinking. Ended links stay in `DiscordLinkHistory`.
- Banned characters, and characters with an indefinite ban or silence, cannot link. A
  Discord id held by an active sanction tombstone cannot link; deleting a sanctioned account
  adds its linked Discord id to the tombstone.
- A ban or silence imposed for at least `DISCORD_INDEFINITE_SANCTION_DAYS` (365), measured
  from the moderation decision, counts as indefinite while it runs and bans the linked Discord account from the server, with the report id in the
  audit-log reason. Clearing or expiry lifts the Discord ban. Players cannot unlink while
  such a sanction runs; a force-unlink or account deletion leaves the Discord ban in place.
- Linking a Discord account that differs from the account's own Clerk Discord login, or that
  is another linked character's Clerk Discord login, writes a staff-visible ActionLog flag
  without blocking.

## Linking from the Discord sign-in

Clerk's "Sign in with Discord" and account linking use the same Discord application (TNR,
`DISCORD_CLIENT_ID`). When a signed-in player starts linking (`/discord/link` or the profile
button, both `/api/discord/authorize`) after clicking on our own pages (`Sec-Fetch-Site:
same-origin`), the route first asks Clerk for the token of the player's Discord sign-in
(`users.getUserOauthAccessToken(userId, "discord")`). If that token carries `identify` and
`role_connections.write`, and Discord's `/oauth2/@me` confirms it was issued to this
application for the same Discord account, the link is completed right away with that token,
without a consent screen. The same rules apply as for the consent flow, and the result page
and profile say "Linked automatically from your Discord sign-in."

Without a Discord sign-in, with a Clerk token from before the scopes were added (the player
has not signed in with Discord since), or when anything in that check fails, the route falls
back to the consent flow unchanged.

Such links have `tokenSource = CLERK` and store no token: Clerk stores and refreshes its own,
so every sync asks Clerk for the current one and the game never revokes it. Clerk's scopes are
copied back to the link, so `guilds.join` granted later is used to add the player to the
server. When Clerk no longer has a usable token for the linked Discord account (Discord
removed from the sign-in methods, the app deauthorized in Discord, scope missing), the sync
stores a "Discord authorization missing" error and the profile offers **Re-link Discord**,
which uses Clerk again if possible and otherwise the consent flow. OAuth links whose refresh
token Discord rejects get the same error.

In-game actions never wait on Discord. Bans, clears, renames and village changes schedule a
sync after the response; whatever fails is retried by the hourly `/api/hourly-discord-sync`
cron, which compares each link's `synced*` columns with the character and fully re-applies
every link at least weekly.

## Environment

| Variable | Meaning |
| --- | --- |
| `DISCORD_LINKING_ENABLED` | `"true"` turns the feature on; anything else keeps UI, routes and cron off |
| `DISCORD_CLIENT_ID` | Application id (OAuth client id) of the TNR application Clerk signs in with: `1126186474312839179` |
| `DISCORD_CLIENT_SECRET` | OAuth client secret, the same one Clerk holds; also keys the signed OAuth state |
| `DISCORD_BOT_TOKEN` | Bot token of the same application |
| `DISCORD_GUILD_ID` | TNR server id |
| `DISCORD_VERIFIED_ROLE_ID` | Optional. Role the bot adds to every linked member. Leave unset when the Verified role is a Linked Role, which Discord grants itself |
| `DISCORD_VILLAGE_ROLE_IDS` | Optional JSON object of village id to role id, e.g. `{"<villageId>":"<roleId>"}`. Changing it needs a redeploy |
| `DISCORD_TOKEN_ENCRYPTION_KEY` | 32 random bytes as base64 or hex (`openssl rand -base64 32`); encrypts stored OAuth tokens with AES-256-GCM. Rotating it invalidates stored tokens until players relink |

The feature also needs `NEXT_PUBLIC_BASE_URL` (redirect URI) and `CRON_SECRET` (sync cron).

## Discord developer portal

Linking reuses the **TNR** application (id `1126186474312839179`) that Clerk already uses for
"Sign in with Discord" through custom credentials (redirect
`https://clerk.theninja-rpg.com/v1/oauth_callback`). Its Linked Roles metadata and role
connections therefore belong to the same application the players sign in with.

1. Copy the **Application ID** (`DISCORD_CLIENT_ID`) and **Client Secret**
   (`DISCORD_CLIENT_SECRET`). Clerk holds the same secret: **resetting the client secret
   requires updating it in Clerk at the same time** (Clerk Dashboard → Configure → SSO
   connections → Discord → Use custom credentials), or Discord sign-in breaks.
2. **OAuth2 → Redirects**: keep Clerk's redirect and add
   `https://www.theninja-rpg.com/api/discord/callback` (and the equivalent
   `<NEXT_PUBLIC_BASE_URL>/api/discord/callback` for preview or local testing).
3. **General Information → Linked Roles Verification URL**:
   `https://www.theninja-rpg.com/discord/link`.
4. **Bot**: create the bot, copy the token. No privileged gateway intents are needed.
5. Invite the bot with scope `bot` and permissions `402653189` (Create Instant Invite, Ban
   Members, Manage Nicknames, Manage Roles):
   `https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&scope=bot&permissions=402653189`.
6. Register the metadata schema (`linked` boolean, `level` integer minimum):
   `make discord-register-metadata` (or `bun run discord:register-metadata` in `app/`) with
   `DISCORD_CLIENT_ID` and `DISCORD_BOT_TOKEN` set.

Players authorize the scopes `identify role_connections.write guilds.join` on the consent
screen.

## Clerk

Clerk Dashboard → Configure → SSO connections → Discord → Use custom credentials →
**Scopes**: add `role_connections.write guilds.join` next to the default `identify email`.
Clerk requests them on each new Discord sign-in, so tokens of players who signed in before the
change lack them until their next Discord sign-in; those players get the consent flow.

## Server setup

1. Create **Verified Ninja**. Under *Links*, add the TNR application requirement
   "Linked ninja". Optionally require a minimum character level.
2. Place the bot's role above Verified Ninja and the village roles, or it cannot assign
   them, change nicknames below it or ban.
3. `@everyone`: remove *View Channels* everywhere except a `#verify` channel that explains
   the steps and links to `https://www.theninja-rpg.com/discord/link`. Grant *View Channels*
   to Verified Ninja.
4. Create one role per village and put their ids in `DISCORD_VILLAGE_ROLE_IDS`.

## Rollout

1. Deploy with `DISCORD_LINKING_ENABLED` unset.
2. Configure the portal, the Clerk scopes, the server roles and the environment variables,
   register the metadata, then set `DISCORD_LINKING_ENABLED=true` and redeploy.
3. Grace period: keep channels visible to `@everyone` while players link (announce a
   deadline in-game and on Discord), and watch `/reports/discord` and sync errors.
4. After the deadline, remove `@everyone` *View Channels* so only Verified Ninja sees the
   server.

Turning the flag off again hides the UI and stops syncs; existing links and Discord roles
stay untouched.
