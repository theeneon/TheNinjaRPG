CREATE TABLE `RecruitRankMilestone` (
	`id` int AUTO_INCREMENT NOT NULL,
	`recruitUserId` varchar(191) NOT NULL,
	`recruiterId` varchar(191) NOT NULL,
	`rank` enum('GENIN','CHUNIN','JONIN') NOT NULL,
	`status` enum('PAID','PRE_EXISTING','INELIGIBLE','NO_RECRUITER') NOT NULL,
	`reputationAwarded` int NOT NULL DEFAULT 0,
	`reachedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `RecruitRankMilestone_id` PRIMARY KEY(`id`),
	CONSTRAINT `RecruitRankMilestone_recruitUserId_rank_key` UNIQUE(`recruitUserId`,`rank`)
);

CREATE TABLE `RecruitReferral` (
	`recruitUserId` varchar(191) NOT NULL,
	`recruiterId` varchar(191) NOT NULL,
	`isEligible` boolean NOT NULL,
	`eligibilityReason` enum('IP_NOT_SHARED','IP_UNKNOWN','SHARED_IP','SELF_REFERRAL','BACKFILL_IP_NOT_SHARED','BACKFILL_SHARED_IP','BACKFILL_UNVERIFIED') NOT NULL,
	`eligibilityCheckedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `RecruitReferral_recruitUserId` PRIMARY KEY(`recruitUserId`)
);

ALTER TABLE `RecruitmentRewards` MODIFY COLUMN `type` enum('MONEY','REPUTATION','PRESTIGE','CLAN_POINTS','RANK_MILESTONE') NOT NULL;
ALTER TABLE `UserData` ADD `unreadRecruitRewards` smallint DEFAULT 0 NOT NULL;
CREATE INDEX `RecruitRankMilestone_recruiterId_idx` ON `RecruitRankMilestone` (`recruiterId`);
CREATE INDEX `RecruitReferral_recruiterId_idx` ON `RecruitReferral` (`recruiterId`);
CREATE INDEX `UserData_lastIp_idx` ON `UserData` (`lastIp`);