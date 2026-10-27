/**
 * Database access for audio; authorization and transaction scopes stay in callers.
 */
import { and, desc, eq, isNotNull, lte } from "drizzle-orm";
import { historicalSoundEffect } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import type { GenerateAudioInput } from "@/validators/audio";

/** Build the `historicalSoundEffect` selection for `getHistorical`, including predicates on `relationId`, `done`, `url`. */
export const selectHistoricalSoundEffectForGetHistorical = (
  client: Pick<DrizzleClient, "select">,
  relationId: string,
  cursor: undefined | null | number,
  limit: number,
) =>
  client
    .select()
    .from(historicalSoundEffect)
    .where(
      and(
        eq(historicalSoundEffect.relationId, relationId),
        eq(historicalSoundEffect.done, true),
        isNotNull(historicalSoundEffect.url),
        cursor != null ? lte(historicalSoundEffect.id, cursor) : undefined,
      ),
    )
    .orderBy(desc(historicalSoundEffect.id))
    .limit(limit + 1);

/** Record a successful, completed sound effect for the user, with optional generation settings. */
export const insertHistoricalSoundEffect = async (
  client: DrizzleClient,
  userId: string,
  url: string,
  config?: GenerateAudioInput,
) => {
  await client.insert(historicalSoundEffect).values({
    ...(config ?? {}),
    userId,
    url,
    status: "success",
    done: true,
  });
};
