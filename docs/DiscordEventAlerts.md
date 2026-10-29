# Discord event alerts

Players select any combination of three optional roles in Discord: **Raids**, **Wars**,
and **Territory Wars**. These roles are independent of account linking and village roles.
The game posts alerts through one incoming webhook; it does not assign these roles.

## Discord server setup

Apply the schema migration creating `DiscordEventDelivery` and adding `Quest.raidStartedAt`
before deploying the minute job.

1. Create three roles without administrative permissions. Expose them as optional choices
   in Discord's Channels & Roles onboarding, or the server's existing self-role system.
   Do not assign them automatically to all members.
2. Allow the webhook to mention these roles (make them mentionable, or grant its integration
   the necessary mention permission). Give the integration access to the alert channel.
3. Create an incoming webhook for that channel and configure these server-only variables:

   | Variable | Value |
   | --- | --- |
   | `DISCORD_EVENT_UPDATES` | HTTPS Discord incoming webhook URL |
   | `DISCORD_RAIDS_ROLE_ID` | Raids role ID |
   | `DISCORD_WARS_ROLE_ID` | Wars role ID |
   | `DISCORD_TERRITORY_WARS_ROLE_ID` | Territory Wars role ID |

   Enable Developer Mode in Discord to copy role IDs. An omitted role disables its category;
   an omitted webhook disables all event alerts. Never expose the webhook token publicly.
4. Keep `/api/territory-war-maintenance` scheduled every minute and configure `CRON_SECRET`.

`allowed_mentions` permits only the category's configured role. Names cannot introduce
`@everyone`, user pings or other role pings. Discord notification preferences still apply.
See Discord's [webhook API](https://docs.discord.com/developers/resources/webhook#execute-webhook)
and [allowed mentions](https://docs.discord.com/developers/resources/message#allowed-mentions-object).

## Events and delivery

- Raids: start, then end with boss defeat or timeout. Hidden/unconfigured raids are omitted.
- Wars: village wars, sector wars and faction raids name the attacker and defender at
  declaration and show the winner or draw at the end. Objective wars include combat opening time.
- Territory Wars: the next event's warning enters the 30-minute window after the previous
  event's actual resolution plus `TERRITORY_WAR_INTERVAL_HOURS`. Start alerts name the
  selected sector; end alerts include every rewarded winner, or explain that nobody scored.
  The initial event has no predecessor from which to calculate a warning.

The minute job reads committed state after territory maintenance. It uses deterministic
`GameSetting` IDs prefixed with `discord-event:` for category activation markers. Immutable
`DiscordEventDelivery` messages and receipts retain retries when a raid quest is reused.
Open raids restored after defeat receive a new activation timestamp; ordinary content edits
retain the current run. Completed history predating activation
is not replayed. Ongoing events are announced once when alerts are enabled.

Each delivery uses a two-minute timestamp lease and a ten-second HTTP timeout. Confirmed
messages are marked delivered; errors leave them eligible for the next tick, and a failed
webhook stops that tick's batch. A batch sends at most twenty messages. Discord acceptance
and the receipt cannot be atomic: a crash between them may repeat a message. No Discord
request runs inside a combat or reward transaction. Tests disable external posts.
