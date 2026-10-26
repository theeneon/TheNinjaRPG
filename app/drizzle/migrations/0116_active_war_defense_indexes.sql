CREATE INDEX `KageDefendedChallenges_village_status_resolved_idx` ON `KageDefendedChallenges` (`villageId`,`status`,`resolvedAt`);
CREATE INDEX `War_endedAt_idx` ON `War` (`endedAt`);