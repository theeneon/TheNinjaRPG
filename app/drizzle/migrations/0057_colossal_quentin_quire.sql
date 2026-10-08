CREATE TABLE `ItemPurchaseCounter` (
	`userId` varchar(191) NOT NULL,
	`itemId` varchar(191) NOT NULL,
	`period` enum('NONE','DAILY','WEEKLY','MONTHLY') NOT NULL,
	`periodStart` datetime(3) NOT NULL,
	`quantity` int unsigned NOT NULL DEFAULT 0,
	CONSTRAINT `ItemPurchaseCounter_user_item_period_key` UNIQUE(`userId`,`itemId`,`period`,`periodStart`)
);

ALTER TABLE `Item` ADD `auctionMinPrice` int unsigned;
ALTER TABLE `Item` ADD `auctionMaxPrice` int unsigned;
ALTER TABLE `Item` ADD `purchaseLimit` int unsigned;
ALTER TABLE `Item` ADD `purchaseLimitPeriod` enum('NONE','DAILY','WEEKLY','MONTHLY') DEFAULT 'NONE' NOT NULL;