CREATE INDEX `ForumAlert_postId_idx` ON `ForumAlert` (`postId`);
CREATE INDEX `ForumAlert_threadId_idx` ON `ForumAlert` (`threadId`);
CREATE INDEX `ForumRead_thread_read_idx` ON `ForumRead` (`threadId`,`readAt`);