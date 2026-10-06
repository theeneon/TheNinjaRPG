CREATE TABLE `RecruitRankMilestone` (
	`id` int AUTO_INCREMENT NOT NULL,
	`recruitUserId` varchar(191) NOT NULL,
	`recruiterId` varchar(191) NOT NULL,
	`rank` enum('GENIN','CHUNIN','JONIN','ELITE JONIN') NOT NULL,
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

-- recruit-milestones-backfill:start
-- Data backfill for the tables above. PlanetScale deploy requests only carry the schema
-- changes, so run everything from the marker above directly on the production branch after
-- the schema is deployed and before the app is deployed. The statements below are separated by
-- statement-breakpoint markers and are idempotent (INSERT IGNORE), so this section can be
-- re-run on its own, e.g. after the app deploy to cover recruits who registered in between.
-- --> statement-breakpoint
-- Backfill recruit referrals and their rank milestones for recruits that predate them.
--
-- Both statements are INSERT IGNORE keyed on the tables' primary/unique keys, so the file can
-- be re-run safely: rows written since (by registration or by a rank-up) are left untouched,
-- and re-running after the application deploy covers recruits that registered in between.
--
-- Eligibility. These referrals were never checked at signup and their signup IP is not
-- stored, so they are judged on the IP history that remains: HistoricalIp (pruned after 90
-- days) and UserData.lastIp. A recruit is
--   SELF_REFERRAL          when it is its own recruiter,
--   BACKFILL_SHARED_IP     when any of its IPs is recorded for another account,
--   BACKFILL_IP_NOT_SHARED when it has IP history and none of it is shared (eligible),
--   BACKFILL_UNVERIFIED    when no IP history remains to check it against.
-- Only BACKFILL_IP_NOT_SHARED is eligible. The placeholder 'unknown' and empty strings that
-- older rows carry are not IPs and never match.
INSERT IGNORE INTO `RecruitReferral` (`recruitUserId`, `recruiterId`, `isEligible`, `eligibilityReason`)
SELECT
  `r`.`userId`,
  `r`.`recruiterId`,
  CASE
    WHEN `r`.`recruiterId` = `r`.`userId` THEN 0
    WHEN `r`.`sharedIp` = 1 THEN 0
    WHEN `r`.`hasIp` = 1 THEN 1
    ELSE 0
  END,
  CASE
    WHEN `r`.`recruiterId` = `r`.`userId` THEN 'SELF_REFERRAL'
    WHEN `r`.`sharedIp` = 1 THEN 'BACKFILL_SHARED_IP'
    WHEN `r`.`hasIp` = 1 THEN 'BACKFILL_IP_NOT_SHARED'
    ELSE 'BACKFILL_UNVERIFIED'
  END
FROM (
  SELECT
    `u`.`userId`,
    `u`.`recruiterId`,
    COALESCE(
      `u`.`lastIp` NOT IN ('', 'unknown')
      OR EXISTS (
        SELECT 1 FROM `HistoricalIp` `h`
        WHERE `h`.`userId` = `u`.`userId` AND `h`.`ip` NOT IN ('', 'unknown')
      ),
      0
    ) AS `hasIp`,
    COALESCE(
      EXISTS (
        SELECT 1 FROM `HistoricalIp` `h`
        JOIN `HistoricalIp` `o` ON `o`.`ip` = `h`.`ip`
        WHERE `h`.`userId` = `u`.`userId`
          AND `o`.`userId` <> `u`.`userId`
          AND `h`.`ip` NOT IN ('', 'unknown')
      )
      OR EXISTS (
        SELECT 1 FROM `HistoricalIp` `h`
        JOIN `UserData` `o` ON `o`.`lastIp` = `h`.`ip`
        WHERE `h`.`userId` = `u`.`userId`
          AND `o`.`userId` <> `u`.`userId`
          AND `h`.`ip` NOT IN ('', 'unknown')
      )
      OR (
        `u`.`lastIp` NOT IN ('', 'unknown')
        AND (
          EXISTS (
            SELECT 1 FROM `UserData` `o`
            WHERE `o`.`lastIp` = `u`.`lastIp` AND `o`.`userId` <> `u`.`userId`
          )
          OR EXISTS (
            SELECT 1 FROM `HistoricalIp` `o`
            WHERE `o`.`ip` = `u`.`lastIp` AND `o`.`userId` <> `u`.`userId`
          )
        )
      ),
      0
    ) AS `sharedIp`
  FROM `UserData` `u`
  WHERE `u`.`recruiterId` IS NOT NULL
) AS `r`;
-- --> statement-breakpoint
-- Ranks a recruit already holds are recorded as reached without payment, so they can never
-- pay later. Every rank implies the milestones below it. Elders are chosen from Jonin and
-- rank below Elite Jonin, so they hold the milestones up to Jonin but not Elite Jonin.
INSERT IGNORE INTO `RecruitRankMilestone` (`recruitUserId`, `recruiterId`, `rank`, `status`, `reputationAwarded`)
SELECT `u`.`userId`, `u`.`recruiterId`, `m`.`milestone`, 'PRE_EXISTING', 0
FROM `UserData` `u`
JOIN (
  SELECT 'GENIN' AS `milestone`, 1 AS `position`
  UNION ALL SELECT 'CHUNIN', 2
  UNION ALL SELECT 'JONIN', 3
  UNION ALL SELECT 'ELITE JONIN', 4
) AS `m`
  ON `m`.`position` <= CASE `u`.`rank`
    WHEN 'GENIN' THEN 1
    WHEN 'CHUNIN' THEN 2
    WHEN 'JONIN' THEN 3
    WHEN 'ELDER' THEN 3
    WHEN 'ELITE JONIN' THEN 4
    ELSE 0
  END
WHERE `u`.`recruiterId` IS NOT NULL;
