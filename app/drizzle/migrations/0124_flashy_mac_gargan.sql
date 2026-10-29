CREATE TABLE `ForumAlert` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`threadId` varchar(191) NOT NULL,
	`postId` varchar(191) NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`readAt` datetime(3),
	CONSTRAINT `ForumAlert_id` PRIMARY KEY(`id`),
	CONSTRAINT `ForumAlert_user_post_key` UNIQUE(`userId`,`postId`)
);

CREATE TABLE `ForumAudit` (
	`id` varchar(191) NOT NULL,
	`actorId` varchar(191) NOT NULL,
	`boardId` varchar(191),
	`action` varchar(64) NOT NULL,
	`targetId` varchar(191) NOT NULL,
	`reason` text NOT NULL,
	`before` json,
	`after` json,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `ForumAudit_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ForumGrant` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`scope` enum('GLOBAL','SECTION','BOARD') NOT NULL,
	`scopeId` varchar(191) NOT NULL,
	`permissions` json NOT NULL,
	`denies` json NOT NULL,
	CONSTRAINT `ForumGrant_id` PRIMARY KEY(`id`),
	CONSTRAINT `ForumGrant_user_scope_key` UNIQUE(`userId`,`scope`,`scopeId`)
);

CREATE TABLE `ForumReaction` (
	`userId` varchar(191) NOT NULL,
	`postId` varchar(191) NOT NULL,
	`reaction` varchar(32) NOT NULL,
	CONSTRAINT `ForumReaction_userId_postId_reaction_pk` PRIMARY KEY(`userId`,`postId`,`reaction`)
);

CREATE TABLE `ForumRead` (
	`userId` varchar(191) NOT NULL,
	`threadId` varchar(191) NOT NULL,
	`readAt` datetime(3) NOT NULL,
	`postId` varchar(191) NOT NULL,
	CONSTRAINT `ForumRead_userId_threadId_pk` PRIMARY KEY(`userId`,`threadId`)
);

CREATE TABLE `ForumRestriction` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`boardId` varchar(191),
	`reason` text NOT NULL,
	`expiresAt` datetime(3) NOT NULL,
	CONSTRAINT `ForumRestriction_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ForumRevision` (
	`id` varchar(191) NOT NULL,
	`postId` varchar(191) NOT NULL,
	`actorId` varchar(191) NOT NULL,
	`content` text NOT NULL,
	`reason` text NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `ForumRevision_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ForumSection` (
	`id` varchar(191) NOT NULL,
	`name` varchar(191) NOT NULL,
	`summary` text NOT NULL,
	`position` int NOT NULL DEFAULT 0,
	`archived` boolean NOT NULL DEFAULT false,
	`policy` json NOT NULL DEFAULT ('{}'),
	CONSTRAINT `ForumSection_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ForumWatch` (
	`userId` varchar(191) NOT NULL,
	`scope` enum('BOARD','THREAD') NOT NULL,
	`scopeId` varchar(191) NOT NULL,
	`push` boolean NOT NULL DEFAULT false,
	CONSTRAINT `ForumWatch_userId_scope_scopeId_pk` PRIMARY KEY(`userId`,`scope`,`scopeId`)
);

DROP INDEX `ForumPost_threadId_idx` ON `ForumPost`;
DROP INDEX `ForumThread_boardId_idx` ON `ForumThread`;
ALTER TABLE `ForumBoard` ADD `sectionId` varchar(191);
ALTER TABLE `ForumBoard` ADD `parentId` varchar(191);
ALTER TABLE `ForumBoard` ADD `position` int DEFAULT 0 NOT NULL;
ALTER TABLE `ForumBoard` ADD `archived` boolean DEFAULT false NOT NULL;
ALTER TABLE `ForumBoard` ADD `rules` text DEFAULT ('') NOT NULL;
ALTER TABLE `ForumBoard` ADD `policy` json DEFAULT ('{}') NOT NULL;
ALTER TABLE `ForumBoard` ADD `slowModeSeconds` int DEFAULT 0 NOT NULL;
ALTER TABLE `ForumBoard` ADD `requireApproval` boolean DEFAULT false NOT NULL;
ALTER TABLE `ForumPost` ADD `editedAt` datetime(3);
ALTER TABLE `ForumPost` ADD `deletedAt` datetime(3);
ALTER TABLE `ForumPost` ADD `removedBy` varchar(191);
ALTER TABLE `ForumPost` ADD `removalReason` text;
ALTER TABLE `ForumPost` ADD `isLocked` boolean DEFAULT false NOT NULL;
ALTER TABLE `ForumPost` ADD `isApproved` boolean DEFAULT true NOT NULL;
ALTER TABLE `ForumThread` ADD `deletedAt` datetime(3);
ALTER TABLE `ForumThread` ADD `isApproved` boolean DEFAULT true NOT NULL;
ALTER TABLE `ForumThread` ADD `kind` enum('DISCUSSION','QUESTION','ANNOUNCEMENT') DEFAULT 'DISCUSSION' NOT NULL;
ALTER TABLE `ForumThread` ADD `tags` json DEFAULT ('[]') NOT NULL;
ALTER TABLE `ForumThread` ADD `acceptedPostId` varchar(191);
CREATE INDEX `ForumAlert_user_created_idx` ON `ForumAlert` (`userId`,`createdAt`);
CREATE INDEX `ForumAudit_board_created_idx` ON `ForumAudit` (`boardId`,`createdAt`);
CREATE INDEX `ForumAudit_target_idx` ON `ForumAudit` (`targetId`);
CREATE INDEX `ForumReaction_postId_idx` ON `ForumReaction` (`postId`);
CREATE INDEX `ForumRestriction_userId_idx` ON `ForumRestriction` (`userId`);
CREATE INDEX `ForumRevision_postId_idx` ON `ForumRevision` (`postId`);
CREATE INDEX `ForumBoard_sectionId_idx` ON `ForumBoard` (`sectionId`);
CREATE INDEX `ForumPost_threadId_idx` ON `ForumPost` (`threadId`,`createdAt`,`id`);
CREATE INDEX `ForumThread_boardId_idx` ON `ForumThread` (`boardId`,`updatedAt`,`id`);
-- Preserve existing section names and descriptions before replacing the display-string hierarchy.
INSERT INTO ForumSection (id, name, summary, position, policy)
SELECT CONCAT('section-', SHA2(legacyGroup, 256)),
       COALESCE(NULLIF(SUBSTRING_INDEX(legacyGroup, ':', 1), ''), 'Forum'),
       IF(LOCATE(':', legacyGroup) > 0, SUBSTRING(legacyGroup, LOCATE(':', legacyGroup) + 1), ''),
       CASE WHEN legacyGroup LIKE 'Main Broadcast:%' THEN 0 WHEN legacyGroup LIKE 'Text-Based RPG:%' THEN 1 ELSE 2 END,
       JSON_OBJECT()
FROM (SELECT DISTINCT CAST(`group` AS BINARY) AS legacyGroup FROM ForumBoard) legacy;
UPDATE ForumBoard SET sectionId = CONCAT('section-', SHA2(`group`, 256)),
       policy = IF(name = 'News', JSON_OBJECT('create', 'STAFF'), JSON_OBJECT());
ALTER TABLE ForumBoard MODIFY sectionId varchar(191) NOT NULL;
UPDATE ForumThread SET kind = 'ANNOUNCEMENT' WHERE boardId IN (SELECT id FROM ForumBoard WHERE name = 'News');
UPDATE ForumThread SET kind = 'QUESTION' WHERE boardId IN (SELECT id FROM ForumBoard WHERE name = 'Questions & Answers');
-- Post counts include the opening post; activity follows the newest visible post.
UPDATE ForumThread SET nPosts = (SELECT COUNT(*) FROM ForumPost WHERE ForumPost.threadId = ForumThread.id),
 updatedAt = COALESCE((SELECT MAX(createdAt) FROM ForumPost WHERE ForumPost.threadId = ForumThread.id), createdAt);
UPDATE ForumBoard SET nThreads = (SELECT COUNT(*) FROM ForumThread WHERE ForumThread.boardId = ForumBoard.id),
 nPosts = (SELECT COALESCE(SUM(nPosts), 0) FROM ForumThread WHERE ForumThread.boardId = ForumBoard.id),
 updatedAt = COALESCE((SELECT MAX(updatedAt) FROM ForumThread WHERE ForumThread.boardId = ForumBoard.id), createdAt);

ALTER TABLE `ForumBoard` DROP COLUMN `group`;

ALTER TABLE `ForumThread` ADD `lastPostId` varchar(191);
UPDATE ForumThread SET lastPostId = (SELECT id FROM ForumPost WHERE ForumPost.threadId = ForumThread.id AND ForumPost.deletedAt IS NULL AND ForumPost.isApproved = true ORDER BY ForumPost.createdAt DESC, ForumPost.id DESC LIMIT 1);

ALTER TABLE `ForumThread` ADD `pollId` varchar(191);
ALTER TABLE `ForumThread` ADD `summary` text;
ALTER TABLE `ForumThread` ADD `summaryUpdatedAt` datetime(3);

ALTER TABLE `ForumPost` ADD `publicationIntent` json;

CREATE INDEX `ForumAlert_postId_idx` ON `ForumAlert` (`postId`);
CREATE INDEX `ForumAlert_threadId_idx` ON `ForumAlert` (`threadId`);
CREATE INDEX `ForumRead_thread_read_idx` ON `ForumRead` (`threadId`,`readAt`);
