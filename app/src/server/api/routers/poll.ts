import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { Poll, PollOption } from "@/drizzle/schema";
import { poll } from "@/drizzle/schema";
import {
  deletePollOptionForDeletePollOption,
  deleteUserPollVoteForDeletePollOption,
  deleteUserPollVoteForRetractVote,
  fetchPoll,
  fetchUserVote,
  findPollOptionForAddOption,
  findPollOptionForDeletePollOption,
  findPollOptionForVote,
  insertActionLogForAddOption,
  insertActionLogForAddOption2,
  insertActionLogForClosePoll,
  insertActionLogForCreatePoll,
  insertActionLogForDeletePollOption,
  insertActionLogForUpdatePoll,
  insertPollForCreatePoll,
  insertPollOptionForAddOption,
  insertPollOptionForAddOption2,
  insertPollOptionForCreatePoll,
  insertUserPollVoteForVote,
  listPollForGetPolls,
  selectUserPollVoteForGetVoteCountsForPolls,
  selectUserPollVoteForGetVoteCountsForPolls2,
  updatePollForClosePoll,
  updatePollForUpdatePoll,
  updateUserPollVoteForVote,
} from "@/queries/poll";
import { fetchUser } from "@/queries/profile";

import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import {
  canAddNonCustomPollOptions,
  canClosePolls,
  canCreatePolls,
  canDeletePollOptions,
  canEditPolls,
  canInteractWithPolls,
} from "@/utils/permissions";
import {
  addPollOptionSchema,
  closePollSchema,
  createPollSchema,
  deletePollOptionSchema,
  getPollsSchema,
  retractVoteSchema,
  updatePollSchema,
  votePollSchema,
} from "@/validators/poll";

export const pollRouter = createTRPCRouter({
  // Create a new poll
  createPoll: protectedProcedure
    .input(createPollSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!user) return errorResponse("User not found");
      if (!canInteractWithPolls(user.rank)) {
        return errorResponse("Too low rank to vote. Must be at least Genin.");
      }
      if (!canCreatePolls(user.role)) {
        return errorResponse("You don't have permission to create polls");
      }
      // Create poll
      const pollId = nanoid();

      // Create poll options with proper type casting
      const optionsToInsert = input.options.map((option) => {
        if (option.type === "text") {
          return {
            id: nanoid(),
            pollId,
            text: option.text,
            optionType: "text" as const,
            createdByUserId: user.userId,
            isCustomOption: false,
          };
        } else if (option.type === "user") {
          return {
            id: nanoid(),
            pollId,
            text: option.username,
            optionType: "user" as const,
            targetUserId: option.userId,
            createdByUserId: user.userId,
            isCustomOption: false,
          };
        }
        // This should never happen due to the discriminated union
        throw new Error("Invalid option type");
      });

      // Run both database operations in parallel
      await Promise.all([
        insertPollForCreatePoll(ctx.drizzle, pollId, input, user),
        insertPollOptionForCreatePoll(ctx.drizzle, optionsToInsert),
        insertActionLogForCreatePoll(ctx.drizzle, user, input, pollId),
      ]);

      return { success: true, message: "Poll created successfully" };
    }),

  // Update a poll
  updatePoll: protectedProcedure
    .input(updatePollSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Get user and poll in parallel
      const [user, existingPoll] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchPoll(ctx.drizzle, input.id),
      ]);

      // Guard
      if (!user) return errorResponse("User not found");
      if (!canInteractWithPolls(user.rank)) {
        return errorResponse("Too low rank to vote. Must be at least Genin.");
      }
      if (!existingPoll) return errorResponse("Poll not found");
      if (existingPoll.createdByUserId !== user.userId && !canEditPolls(user.role)) {
        return errorResponse("You don't have permission to update this poll");
      }

      // Get the new poll data
      const updateData: Record<string, unknown> = {};
      if (input.title !== undefined) updateData.title = input.title;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.allowCustomOptions !== undefined)
        updateData.allowCustomOptions = input.allowCustomOptions;
      if (input.isActive !== undefined) updateData.isActive = input.isActive;
      if (input.endDate !== undefined) updateData.endDate = input.endDate;

      // Update poll
      await updatePollForUpdatePoll(ctx.drizzle, updateData, input);
      await insertActionLogForUpdatePoll(
        ctx.drizzle,
        user,
        existingPoll,
        updateData,
        input,
      );

      return { success: true, message: "Poll updated successfully" };
    }),

  // Vote in a poll
  vote: protectedProcedure
    .input(votePollSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Get user, poll, option, and existing vote in parallel
      const [user, existingPoll, existingVote, option] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchPoll(ctx.drizzle, input.pollId),
        fetchUserVote(ctx.drizzle, ctx.userId, input.pollId),
        findPollOptionForVote(ctx.drizzle, input),
      ]);
      // Guard
      if (!user) return errorResponse("User not found");
      if (!canInteractWithPolls(user.rank)) {
        return errorResponse("Too low rank to vote. Must be at least Genin.");
      }
      if (!existingPoll) return errorResponse("Poll not found");
      if (!existingPoll.isActive) return errorResponse("Poll is not active");
      if (!option) return errorResponse("Option not found");
      if (existingPoll.endDate && new Date(existingPoll.endDate) < new Date()) {
        return errorResponse("Poll has ended");
      }

      // Update existing vote
      if (existingVote) {
        await updateUserPollVoteForVote(ctx.drizzle, input, existingVote);
        return { success: true, message: "Vote updated successfully" };
      }

      // Create new vote
      await insertUserPollVoteForVote(ctx.drizzle, user, input);
      return { success: true, message: "Vote submitted successfully" };
    }),

  // Add a custom option to a poll
  addOption: protectedProcedure
    .input(addPollOptionSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, existingPoll, existingOption] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchPoll(ctx.drizzle, input.pollId),
        findPollOptionForAddOption(ctx.drizzle, input),
      ]);
      // Guard
      if (!user) return errorResponse("User not found");
      if (!existingPoll) return errorResponse("Poll not found");
      if (existingOption) return errorResponse("Option already exists");
      if (!existingPoll.isActive) return errorResponse("Poll is not active");
      const isAdmin = canAddNonCustomPollOptions(user.role);
      if (!isAdmin && !existingPoll.allowCustomOptions) {
        return errorResponse("Custom options are not allowed for this poll");
      }
      if (existingPoll.endDate && new Date(existingPoll.endDate) < new Date()) {
        return errorResponse("Poll has ended");
      }

      // Create new option
      if (input.type === "text") {
        await insertPollOptionForAddOption(ctx.drizzle, input, user, isAdmin);
        await insertActionLogForAddOption(ctx.drizzle, user, existingPoll, input);
      } else if (input.type === "user") {
        await insertPollOptionForAddOption2(ctx.drizzle, input, user, isAdmin);
        await insertActionLogForAddOption2(ctx.drizzle, user, existingPoll, input);
      } else {
        return errorResponse("Invalid option type");
      }

      return { success: true, message: "Option added successfully" };
    }),

  // Get all polls with pagination
  getPolls: publicProcedure.input(getPollsSchema).query(async ({ ctx, input }) => {
    const currentCursor = input?.cursor ? input.cursor : 0;
    const limit = input?.limit ? input.limit : 10;
    const skip = currentCursor * limit;
    const whereClause = input.includeInactive ? undefined : eq(poll.isActive, true);

    // First, get the polls with their options and creators
    const polls = await listPollForGetPolls(ctx.drizzle, whereClause, skip, limit);

    if (polls.length === 0) {
      return {
        data: [],
        nextCursor: null,
      };
    }

    // Get all poll IDs
    const pollIds = polls.map((p) => p.id);

    // Get vote counts for all polls
    const { optionVoteMap, totalVoteMap } = await getVoteCountsForPolls(
      ctx.drizzle,
      pollIds,
    );

    // Process each poll with the vote data
    const pollsWithVoteCounts = polls.map((pollData) => {
      const totalVotes = totalVoteMap.get(pollData.id) || 0;
      const optionVotes = optionVoteMap.get(pollData.id);

      return processPollWithVotes(pollData, optionVotes, totalVotes);
    });

    const nextCursor = polls.length < limit ? null : currentCursor + 1;
    return {
      data: pollsWithVoteCounts,
      nextCursor,
    };
  }),

  // Get user's vote for a specific poll
  getUserVote: protectedProcedure
    .input(z.object({ pollId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!user) throw new Error("User not found");
      return await fetchUserVote(ctx.drizzle, ctx.userId, input.pollId);
    }),

  // Retract a vote from a poll
  retractVote: protectedProcedure
    .input(retractVoteSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Get user, poll, and existing vote in parallel
      const [user, existingPoll, existingVote] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchPoll(ctx.drizzle, input.pollId),
        fetchUserVote(ctx.drizzle, ctx.userId, input.pollId),
      ]);

      // Guard
      if (!user) return errorResponse("User not found");
      if (!canInteractWithPolls(user.rank)) {
        return errorResponse("Too low rank to vote. Must be at least Genin.");
      }
      if (!existingPoll) return errorResponse("Poll not found");
      if (!existingPoll.isActive) return errorResponse("Poll is not active");
      if (!existingVote) return errorResponse("You haven't voted in this poll");
      if (existingPoll.endDate && new Date(existingPoll.endDate) < new Date()) {
        return errorResponse("Poll has ended");
      }

      // Delete the vote
      await deleteUserPollVoteForRetractVote(ctx.drizzle, existingVote);
      return { success: true, message: "Vote retracted successfully" };
    }),

  // Close or reopen a poll
  closePoll: protectedProcedure
    .input(closePollSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Get user and poll in parallel
      const [user, existingPoll] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchPoll(ctx.drizzle, input.id),
      ]);

      // Guard
      if (!user) return errorResponse("User not found");
      if (!canInteractWithPolls(user.rank)) {
        return errorResponse("Too low rank to vote. Must be at least Genin.");
      }
      if (!existingPoll) return errorResponse("Poll not found");
      if (!canClosePolls(user.role)) {
        return errorResponse("You don't have permission to close polls");
      }

      // Update poll status
      await updatePollForClosePoll(ctx.drizzle, input);
      await insertActionLogForClosePoll(ctx.drizzle, user, input, existingPoll);

      return {
        success: true,
        message: input.isActive
          ? "Poll reopened successfully"
          : "Poll closed successfully",
      };
    }),

  // Delete a poll option
  deletePollOption: protectedProcedure
    .input(deletePollOptionSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Get user, poll, and option in parallel
      const [user, existingPoll, existingOption] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchPoll(ctx.drizzle, input.pollId),
        findPollOptionForDeletePollOption(ctx.drizzle, input),
      ]);

      // Guard
      if (!user) return errorResponse("User not found");
      if (!canInteractWithPolls(user.rank)) {
        return errorResponse("Too low rank to vote. Must be at least Genin.");
      }
      if (!existingPoll) return errorResponse("Poll not found");
      if (!existingOption) return errorResponse("Option not found");

      // Check if user has permission to delete this option
      // Allow if user is admin OR if user created the option
      const isAdmin = canDeletePollOptions(user.role);
      const isCreator = existingOption.createdByUserId === user.userId;

      if (!isAdmin && !isCreator) {
        return errorResponse("You don't have permission to delete this poll option");
      }

      // Delete both the votes and the option in parallel
      await Promise.all([
        // Delete any votes for this option
        deleteUserPollVoteForDeletePollOption(ctx.drizzle, input),

        // Delete the option
        deletePollOptionForDeletePollOption(ctx.drizzle, input),
        insertActionLogForDeletePollOption(ctx.drizzle, user, existingPoll, input),
      ]);

      return { success: true, message: "Poll option deleted successfully" };
    }),
});

// Define types for the poll data with relations
interface PollWithOptions extends Poll {
  createdBy: {
    userId: string;
    username: string;
    avatar: string | null;
  };
  options: (PollOption & {
    createdBy: {
      userId: string;
      username: string;
      avatar: string | null;
    };
    targetUser?: {
      userId: string;
      username: string;
      avatar: string | null;
    } | null;
  })[];
}

/**
 * Helper function to get vote counts for polls
 * @param client - The database client
 * @param pollIds - Array of poll IDs to get vote counts for
 * @returns Object containing vote maps and processed polls
 */
async function getVoteCountsForPolls(client: DrizzleClient, pollIds: string[]) {
  // Run both queries in parallel for better performance
  const [optionVoteCounts, totalVoteCounts] = await Promise.all([
    // Get vote counts for all options in all polls
    selectUserPollVoteForGetVoteCountsForPolls(client, pollIds),

    // Get total votes for all polls
    selectUserPollVoteForGetVoteCountsForPolls2(client, pollIds),
  ]);

  // Create maps for quick lookup
  const optionVoteMap = new Map<string, Map<string, number>>();
  optionVoteCounts.forEach(({ pollId, optionId, count }) => {
    if (!optionVoteMap.has(pollId)) {
      optionVoteMap.set(pollId, new Map<string, number>());
    }
    optionVoteMap.get(pollId)?.set(optionId, count);
  });

  const totalVoteMap = new Map<string, number>();
  totalVoteCounts.forEach(({ pollId, count }) => {
    totalVoteMap.set(pollId, count);
  });

  return { optionVoteMap, totalVoteMap };
}

/**
 * Helper function to process poll data with vote counts
 * @param pollData - The poll data to process
 * @param optionVotes - Map of option votes
 * @param totalVotes - Total votes for the poll
 * @returns Processed poll with vote counts
 */
function processPollWithVotes(
  pollData: PollWithOptions,
  optionVotes: Map<string, number> | undefined,
  totalVotes: number,
) {
  const voteMap = optionVotes || new Map<string, number>();

  // Add vote counts to each option
  const optionsWithVotes = pollData.options.map((option) => ({
    ...option,
    voteCount: voteMap.get(option.id) || 0,
    percentage:
      totalVotes > 0
        ? Math.round(((voteMap.get(option.id) || 0) / totalVotes) * 100)
        : 0,
  }));

  // Sort options by vote count (descending)
  optionsWithVotes.sort((a, b) => b.voteCount - a.voteCount);

  return {
    ...pollData,
    options: optionsWithVotes,
    totalVotes,
  };
}
