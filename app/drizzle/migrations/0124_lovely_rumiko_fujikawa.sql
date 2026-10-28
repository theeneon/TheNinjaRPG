ALTER TABLE `ForumThread` ADD `lastPostId` varchar(191);
UPDATE ForumThread SET lastPostId = (SELECT id FROM ForumPost WHERE ForumPost.threadId = ForumThread.id AND ForumPost.deletedAt IS NULL AND ForumPost.isApproved = true ORDER BY ForumPost.createdAt DESC, ForumPost.id DESC LIMIT 1);
