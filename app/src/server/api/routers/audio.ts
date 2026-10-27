import { z } from "zod";
import { generateAndUploadAudio } from "@/libs/replicate";
import {
  insertHistoricalSoundEffect,
  selectHistoricalSoundEffectForGetHistorical,
} from "@/queries/audio";
import { findUserById } from "@/queries/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import { canChangeContent } from "@/utils/permissions";
import { generateAudioSchema } from "@/validators/audio";
import { mediaHistoryQuerySchema } from "@/validators/mediaHistory";

export const audioRouter = createTRPCRouter({
  generate: protectedProcedure
    .input(generateAudioSchema)
    .output(baseServerResponse.extend({ url: z.string().nullish() }))
    .mutation(async ({ ctx, input }) => {
      // Query
      const user = await findUserById(ctx.drizzle, ctx.userId);
      // Guard
      if (!user) return errorResponse("User not found");
      if (user.isBanned) return errorResponse("You are banned");
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");
      // Generate and upload audio
      const url = await generateAndUploadAudio(input);
      // Guard
      if (!url) return errorResponse("Failed to upload audio");
      // Final insert (store prompts)
      await insertHistoricalSoundEffect(ctx.drizzle, ctx.userId, url, input);
      return { success: true, message: "Audio generated", url };
    }),

  getHistorical: protectedProcedure
    .input(mediaHistoryQuerySchema)
    .query(async ({ ctx, input }) => {
      // Query
      const relationId = input.relationId ?? ctx.userId;
      const limit = input.limit ?? 50;
      const { cursor } = input;
      const rows = await selectHistoricalSoundEffectForGetHistorical(
        ctx.drizzle,
        relationId,
        cursor,
        limit,
      );

      let nextCursor: number | undefined;
      if (rows.length > limit) {
        const nextItem = rows.pop();
        nextCursor = nextItem?.id;
      }
      return { data: rows, nextCursor };
    }),
});
