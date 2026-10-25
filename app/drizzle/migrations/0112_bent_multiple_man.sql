ALTER TABLE `DiscordLink` MODIFY COLUMN `accessToken` text;
ALTER TABLE `DiscordLink` MODIFY COLUMN `refreshToken` text;
ALTER TABLE `DiscordLink` MODIFY COLUMN `tokenExpiresAt` datetime(3);
ALTER TABLE `DiscordLink` ADD `tokenSource` enum('OAUTH','CLERK') DEFAULT 'OAUTH' NOT NULL;