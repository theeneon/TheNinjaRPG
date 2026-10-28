import type { UserRole } from "@/drizzle/constants";
import { canCreateNews, canModerate } from "@/utils/permissions";
import type { ForumCapability, ForumPolicy } from "@/validators/forum";

export const canAdminForum = (role?: UserRole) =>
  !!role && ["OWNER", "MODERATOR-ADMIN", "CODING-ADMIN"].includes(role);

/** Explicit denies win, including over inherited grants. Bootstrap admins retain recovery access. */
export const forumPermissions = (
  actor: {
    userId: string;
    role: UserRole;
    isBanned?: boolean;
    isSilenced?: boolean;
  } | null,
  board: { id: string; sectionId: string; policy: ForumPolicy; archived: boolean },
  section: { policy: ForumPolicy; archived: boolean } | null | undefined,
  grants: {
    userId: string;
    scope: "GLOBAL" | "SECTION" | "BOARD";
    scopeId: string;
    permissions: ForumCapability[];
    denies: ForumCapability[];
  }[],
) => {
  const scoped = grants.filter(
    (g) =>
      g.userId === actor?.userId &&
      (g.scope === "GLOBAL" ||
        (g.scope === "SECTION" && g.scopeId === board.sectionId) ||
        (g.scope === "BOARD" && g.scopeId === board.id)),
  );
  const denied = new Set(scoped.flatMap((g) => g.denies));
  const granted = new Set(scoped.flatMap((g) => g.permissions));
  const admin =
    canAdminForum(actor?.role) || (granted.has("manage") && !denied.has("manage"));
  const moderator = !!actor && (canModerate(actor.role) || granted.has("moderate"));
  const policy = {
    view: "PUBLIC",
    read: "PUBLIC",
    create: "MEMBERS",
    reply: "MEMBERS",
    upload: "MEMBERS",
    vote: "MEMBERS",
    editOwn: true,
    deleteOwn: true,
    ...section?.policy,
    ...board.policy,
  } as const;
  const allows = (capability: ForumCapability) => {
    if (canAdminForum(actor?.role)) return true;
    if (denied.has(capability)) return false;
    if (granted.has(capability)) return true;
    if (admin && capability !== "purge") return true;
    if (["moderate", "approve"].includes(capability)) return moderator;
    if (["manage", "purge"].includes(capability)) return false;
    if (capability === "edit") return !!actor && policy.editOwn;
    if (capability === "remove") return !!actor && policy.deleteOwn;
    const audience =
      policy[capability as "view" | "read" | "create" | "reply" | "upload" | "vote"];
    return (
      audience === "PUBLIC" ||
      (audience === "MEMBERS" && !!actor) ||
      (audience === "STAFF" && !!actor && canCreateNews(actor.role)) ||
      (audience === "MODERATORS" && moderator)
    );
  };
  const view = allows("view");
  const read = view && allows("read");
  const archived = board.archived || !!section?.archived;
  const blocked = !actor || actor.isBanned || actor.isSilenced;
  return {
    view,
    read,
    create: read && !archived && !blocked && allows("create"),
    reply: read && !archived && !blocked && allows("reply"),
    upload: read && !archived && !blocked && allows("upload"),
    vote: read && !archived && !blocked && allows("vote"),
    edit: read && !archived && !blocked && allows("edit"),
    remove: read && !archived && !blocked && allows("remove"),
    editOthers:
      read &&
      !archived &&
      !blocked &&
      !denied.has("edit") &&
      (allows("moderate") || granted.has("edit")),
    removeOthers:
      read &&
      !blocked &&
      !denied.has("remove") &&
      (allows("moderate") || granted.has("remove")),
    moderate: read && !blocked && allows("moderate"),
    approve: read && !blocked && allows("approve"),
    manage: !blocked && admin,
    purge: !blocked && granted.has("purge") && !denied.has("purge"),
    archived,
    policy,
  };
};
export type ForumPermissions = ReturnType<typeof forumPermissions>;

type ForumActor = Parameters<typeof forumPermissions>[0];
type ForumGrants = Parameters<typeof forumPermissions>[3];
type AccessBoard = {
  id: string;
  sectionId: string;
  parentId: string | null;
  policy: ForumPolicy;
  archived: boolean;
  section: { policy: ForumPolicy; archived: boolean } | null;
};

/** Resolve the whole ancestry before deriving capabilities so missing parents fail closed. */
export const forumBoardPermissions = (
  actor: ForumActor,
  board: AccessBoard,
  boards: AccessBoard[],
  grants: ForumGrants,
  canRecover = false,
) => {
  let parent = board.parentId;
  const visited = new Set([board.id]);
  const ancestors: AccessBoard[] = [];
  let valid = !!board.section;
  while (parent) {
    if (visited.has(parent)) {
      valid = false;
      break;
    }
    visited.add(parent);
    const ancestor = boards.find((b) => b.id === parent);
    if (!ancestor || ancestor.sectionId !== board.sectionId) {
      valid = false;
      break;
    }
    ancestors.unshift(ancestor);
    parent = ancestor.parentId;
  }
  const inherited: ForumPolicy = {};
  for (const ancestor of ancestors) Object.assign(inherited, ancestor.policy);
  const permissions = forumPermissions(
    actor,
    {
      ...board,
      policy: { ...inherited, ...board.policy },
      archived: board.archived || ancestors.some((a) => a.archived),
    },
    board.section,
    grants,
  );
  if (!valid && !canRecover) {
    for (const key of [
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
    ] as const)
      permissions[key] = false;
  }
  return permissions;
};
