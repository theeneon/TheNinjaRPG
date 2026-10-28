CREATE TABLE `ForumCase` (
	`postId` varchar(191) NOT NULL,
	`assigneeId` varchar(191),
	`status` enum('OPEN','IN_REVIEW','RESOLVED') NOT NULL DEFAULT 'OPEN',
	`decision` text NOT NULL,
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `ForumCase_postId` PRIMARY KEY(`postId`)
);
