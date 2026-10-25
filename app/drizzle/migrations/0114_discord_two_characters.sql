ALTER TABLE `DiscordLink` ADD `slot` tinyint DEFAULT 1 NOT NULL;
ALTER TABLE `DiscordLink` ADD `isPrimary` boolean DEFAULT true NOT NULL;
ALTER TABLE `DiscordLink` ADD CONSTRAINT `DiscordLink_discordId_slot_key` UNIQUE(`discordId`,`slot`);
ALTER TABLE `DiscordLink` DROP INDEX `DiscordLink_discordId_key`;
