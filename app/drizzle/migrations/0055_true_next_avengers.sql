ALTER TABLE `SkillTree` ADD `pathType` enum('SKILL','BLOODRIGHT') DEFAULT 'SKILL' NOT NULL;
ALTER TABLE `SkillTree` ADD `bloodlineId` varchar(191);
ALTER TABLE `SkillTree` ADD `seichiSilverCost` int DEFAULT 0 NOT NULL;
ALTER TABLE `UserData` ADD `bloodright` json DEFAULT ('[]') NOT NULL;
ALTER TABLE `UserData` ADD `bloodrightSpent` int DEFAULT 0 NOT NULL;
ALTER TABLE `UserData` ADD `monthlySkillResets` json DEFAULT ('{"month":"","count":0}') NOT NULL;
CREATE INDEX `SkillTree_bloodlineId_idx` ON `SkillTree` (`bloodlineId`);