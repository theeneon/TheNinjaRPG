import type { Poll, PollOption } from "@/drizzle/schema";
import {
  selectUserPollVoteForGetVoteCountsForPolls,
  selectUserPollVoteForGetVoteCountsForPolls2,
} from "@/queries/poll";
import type { DrizzleClient } from "@/server/db";

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
export async function getVoteCountsForPolls(client: DrizzleClient, pollIds: string[]) {
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
export function processPollWithVotes<T extends PollWithOptions>(
  pollData: T,
  optionVotes: Map<string, number> | undefined,
  totalVotes: number,
) {
  const voteMap = optionVotes || new Map<string, number>();

  // Add vote counts to each option
  const { options, ...metadata } = pollData;
  const optionsWithVotes = options.map((option) => ({
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
    ...metadata,
    options: optionsWithVotes,
    totalVotes,
  };
}
