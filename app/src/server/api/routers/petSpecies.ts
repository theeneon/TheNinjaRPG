import { nanoid } from "nanoid";
import { isPetJutsuAllowed } from "@/libs/pets/abilities";
import { callDiscordContent } from "@/libs/socials";
import {
  findPetSpeciesForCreate,
  findPetSpeciesForGet,
  findPetSpeciesForUpdate2,
  insertActionLogForCreate,
  insertActionLogForUpdate,
  insertPetSpeciesForCreate,
  listJutsuForCreate,
  listJutsuForUpdate,
  listPetSpeciesForGetAll,
  updatePetSpeciesForUpdate,
} from "@/queries/petSpecies";
import { fetchUser } from "@/queries/profile";

import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "@/server/api/trpc";
import { isMysqlDuplicateKeyError } from "@/server/utils/mysqlErrors";
import { calculateContentDiff } from "@/utils/diff";
import { canChangeContent } from "@/utils/permissions";
import { idSchema } from "@/validators/misc";
import { PetSpeciesValidator, updatePetSpeciesSchema } from "@/validators/petSpecies";

/** Manage authored species independently of each companion's generated artwork and progress. */
export const petSpeciesRouter = createTRPCRouter({
  /** Include retired species so the manual and owned companions retain their identities. */
  getAll: publicProcedure.query(({ ctx }) => listPetSpeciesForGetAll(ctx.drizzle)),

  /** Resolve the same authored identity for both editing and previously adopted pets. */
  get: publicProcedure.input(idSchema).query(async ({ ctx, input }) => {
    const species = await findPetSpeciesForGet(ctx.drizzle, input);
    if (!species) throw serverError("NOT_FOUND", "Companion species not found");
    return species;
  }),

  /** Save a new immutable species ID using the shared Content permission and audit conventions. */
  create: protectedProcedure
    .input(PetSpeciesValidator)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, existing, defaults] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findPetSpeciesForCreate(ctx.drizzle, input),
        input.defaultJutsuIds.length ? listJutsuForCreate(ctx.drizzle, input) : [],
      ]);
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!canChangeContent(user.role))
        return errorResponse("Not allowed to create companion species");
      if (existing) return errorResponse("Companion species name already exists");
      // The new species ID does not exist yet, so defaults must allow any species.
      if (
        defaults.length !== input.defaultJutsuIds.length ||
        defaults.some(
          (entry) => !isPetJutsuAllowed(entry) || !!entry.requiredPetSpeciesId,
        )
      )
        return errorResponse(
          "Choose published, compatible PETS jutsu for the default loadout.",
        );
      const id = nanoid();
      try {
        await insertPetSpeciesForCreate(ctx.drizzle, id, input);
      } catch (error) {
        if (isMysqlDuplicateKeyError(error))
          return errorResponse("Companion species name already exists");
        throw error;
      }
      const changes = calculateContentDiff({}, input);
      await insertActionLogForCreate(ctx.drizzle, ctx, changes, id, input);
      if (process.env.NODE_ENV !== "development") {
        await callDiscordContent(user.username, input.name, changes);
      }
      return { success: true, message: id };
    }),

  /** Retirement removes future offerings; existing pets, portraits and progression stay intact. */
  update: protectedProcedure
    .input(updatePetSpeciesSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, species, existing, defaults] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findPetSpeciesForGet(ctx.drizzle, input),
        findPetSpeciesForUpdate2(ctx.drizzle, input),
        input.data.defaultJutsuIds.length ? listJutsuForUpdate(ctx.drizzle, input) : [],
      ]);
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!canChangeContent(user.role))
        return errorResponse("Not allowed to edit companion species");
      if (!species) return errorResponse("Companion species not found");
      if (existing && existing.id !== species.id)
        return errorResponse("Companion species name already exists");
      if (
        defaults.length !== input.data.defaultJutsuIds.length ||
        defaults.some(
          (entry) =>
            !isPetJutsuAllowed(entry) ||
            (!!entry.requiredPetSpeciesId && entry.requiredPetSpeciesId !== input.id),
        )
      )
        return errorResponse(
          "Choose published, compatible PETS jutsu for the default loadout.",
        );
      const changes = calculateContentDiff(species, { ...species, ...input.data });
      if (changes.length === 0)
        return { success: true, message: "Companion species is already up to date." };
      try {
        const updated = await updatePetSpeciesForUpdate(ctx.drizzle, input, species);
        if (updated.rowsAffected !== 1)
          return errorResponse("Companion species not found");
      } catch (error) {
        if (isMysqlDuplicateKeyError(error))
          return errorResponse("Companion species name already exists");
        throw error;
      }
      await insertActionLogForUpdate(ctx.drizzle, ctx, changes, species);
      if (process.env.NODE_ENV !== "development") {
        await callDiscordContent(user.username, input.data.name, changes);
      }
      return { success: true, message: "Companion species updated." };
    }),
});
