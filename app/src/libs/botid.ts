/**
 * Vercel BotID configuration shared by the browser (`instrumentation-client.ts`) and the
 * tRPC server (`@/server/utils/botid`).
 *
 * Only the Basic check level is used: it is free on every plan, whereas Deep Analysis is
 * billed per `checkBotId()` call. The level must be identical on the client protect entry
 * and on every server call, or verification fails, so both sides read it from here. Keep
 * Deep Analysis disabled in the Vercel dashboard as well; a per-route `checkLevel` takes
 * precedence over the project setting, but nothing here relies on that.
 */
export const BOTID_CHECK_LEVEL = "basic" as const;

/**
 * The only tRPC mutations BotID guards. Each check is a ~150-350 ms round trip to
 * api.vercel.com that the mutation waits for, so the list is limited to high-value
 * targets that a player triggers rarely: grind-loop starts, reward claims, value
 * transfers, account creation and the merch cart. Frequent actions (combat moves,
 * movement, equipping, chat) are deliberately left out.
 */
export const BOTID_PROTECTED_PROCEDURES = [
  // Training and grind loops
  "train.startTraining",
  "jutsu.startTraining",
  "stealth.trainCovert",
  "quests.startQuest",
  "quests.startRandom",
  "combat.startArenaBattle",
  "farming.harvestPlot",
  "farming.harvestAll",
  // Daily and once-per-period rewards
  "profile.claimVotes",
  "activityStreak.claimStreakDay",
  "bank.claimInterest",
  "raids.claimDamageReward",
  "pvpRank.claimSeasonRewards",
  // Account creation and value transfer
  "register.createCharacter",
  "bank.transfer",
  "blackmarket.createOffer",
  "blackmarket.takeOffer",
  "auction.createAuctionListing",
  "auction.placeBid",
  // Merch cart
  "merch.addToCart",
  "merch.updateCart",
  "merch.checkout",
] as const;

const protectedProcedures: ReadonlySet<string> = new Set(BOTID_PROTECTED_PROCEDURES);

/** Whether a tRPC procedure path is one BotID guards. */
export const isBotIdProtectedProcedure = (path: string) =>
  protectedProcedures.has(path);

/**
 * Requests the BotID client attaches its challenge headers to: one entry per protected
 * procedure.
 *
 * httpBatchLink sends every mutation as a POST to `/api/trpc/<path>[,<path>...]?batch=1`
 * and every query as a GET (no `methodOverride` is configured). BotID matches the
 * pathname only, escapes the dots, and turns `*` into `.*`, so `/api/trpc/*<procedure>*`
 * also matches a batch that carries the procedure alongside others (with `,` or `%2C`
 * between them). No procedure name contains another one, so nothing else matches.
 */
export const BOTID_PROTECTED_ROUTES = BOTID_PROTECTED_PROCEDURES.map((procedure) => ({
  path: `/api/trpc/*${procedure}*`,
  method: "POST",
  advancedOptions: { checkLevel: BOTID_CHECK_LEVEL },
}));

/** Shown to a player whose mutation BotID classified as automated. */
export const BOTID_BLOCKED_MESSAGE =
  "Your request was blocked by our bot protection. Please reload the page and try again; contact support if this keeps happening.";
