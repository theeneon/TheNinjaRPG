CREATE INDEX `ActionLog_userId_tableName_idx` ON `ActionLog` (`userId`,`tableName`);
DROP INDEX `ActionLog_userId_idx` ON `ActionLog`;
CREATE INDEX `UserData_isAi_updatedAt_idx` ON `UserData` (`isAi`,`updatedAt`);
CREATE INDEX `UserData_recruiterId_idx` ON `UserData` (`recruiterId`);
