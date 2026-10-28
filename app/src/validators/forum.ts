import { z } from "zod";

export const forumAudiences = [
  "PUBLIC",
  "MEMBERS",
  "STAFF",
  "MODERATORS",
  "NONE",
] as const;
export const forumCapabilities = [
  "view",
  "read",
  "create",
  "reply",
  "upload",
  "vote",
  "edit",
  "remove",
  "moderate",
  "approve",
  "manage",
  "purge",
] as const;
export type ForumCapability = (typeof forumCapabilities)[number];
export const forumPolicySchema = z.object({
  view: z.enum(forumAudiences).optional(),
  read: z.enum(forumAudiences).optional(),
  create: z.enum(forumAudiences).optional(),
  reply: z.enum(forumAudiences).optional(),
  upload: z.enum(forumAudiences).optional(),
  vote: z.enum(forumAudiences).optional(),
  editOwn: z.boolean().optional(),
  deleteOwn: z.boolean().optional(),
});
export type ForumPolicy = z.infer<typeof forumPolicySchema>;
export const forumBoardSchema = z.strictObject({
  board_id: z.string(),
  title: z.string().trim().min(4).max(88),
  content: z.string().min(4).max(10000),
  image: z.url().optional().nullable(),
  senderId: z.string().optional().nullable(),
  kind: z.enum(["DISCUSSION", "QUESTION", "ANNOUNCEMENT"]).optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(5).optional(),
});
export type ForumBoardSchema = z.infer<typeof forumBoardSchema>;
export const forumSectionSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2).max(100),
  summary: z.string().trim().max(1000),
  position: z.number().int().min(0).max(10000),
  archived: z.boolean(),
  policy: forumPolicySchema,
  reason: z.string().trim().min(3).max(500),
});
export const forumStructureBoardSchema = z.object({
  id: z.string().optional(),
  sectionId: z.string(),
  parentId: z.string().nullable(),
  name: z.string().trim().min(2).max(100),
  summary: z.string().trim().max(2000),
  rules: z.string().trim().max(5000),
  position: z.number().int().min(0).max(10000),
  archived: z.boolean(),
  policy: forumPolicySchema,
  slowModeSeconds: z.number().int().min(0).max(86400),
  requireApproval: z.boolean(),
  reason: z.string().trim().min(3).max(500),
});
