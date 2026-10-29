CREATE TABLE `DiscordEventDelivery` (
	`id` varchar(191) NOT NULL,
	`category` enum('raids','wars','territory') NOT NULL,
	`message` text NOT NULL,
	`createdAt` datetime(3) NOT NULL,
	`claimedAt` datetime(3),
	`delivered` boolean NOT NULL DEFAULT false,
	CONSTRAINT `DiscordEventDelivery_id` PRIMARY KEY(`id`)
);

ALTER TABLE `Quest` ADD `raidStartedAt` datetime(3);
CREATE INDEX `DiscordEventDelivery_delivered_createdAt_idx` ON `DiscordEventDelivery` (`delivered`,`createdAt`);