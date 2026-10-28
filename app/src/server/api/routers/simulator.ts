import { z } from "zod";
import {
  deleteDamageSimulationForCreateDamageSimulation,
  deleteDamageSimulationForDeleteDamageSimulation,
  findDamageSimulationById,
  insertDamageSimulationForCreateDamageSimulation,
  listDamageSimulationForCreateDamageSimulation,
  listDamageSimulationForGetDamageSimulations,
  updateDamageSimulationForUpdateDamageSimulation,
  updateDamageSimulationForUpdateDamageSimulation2,
} from "@/queries/simulator";
import {
  baseServerResponse,
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { damageSimulationStateSchema } from "@/validators/combat";
import { idSchema } from "@/validators/misc";

export const simulatorRouter = createTRPCRouter({
  getDamageSimulations: protectedProcedure
    .meta({ mcp: { description: "Get user's damage simulations" } })
    .query(async ({ ctx }) => {
      return await listDamageSimulationForGetDamageSimulations(ctx.drizzle, ctx);
    }),
  getDamageSimulation: publicProcedure
    .meta({ mcp: { description: "Get a specific damage simulation" } })
    .input(idSchema)
    .query(async ({ ctx, input }) => {
      return await fetchEntry(ctx.drizzle, input.id);
    }),
  createDamageSimulation: protectedProcedure
    .meta({ mcp: { description: "Create a new damage simulation" } })
    .input(damageSimulationStateSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const maxEntries = 20;
      const [current] = await Promise.all([
        listDamageSimulationForCreateDamageSimulation(ctx.drizzle, ctx, maxEntries),
        insertDamageSimulationForCreateDamageSimulation(ctx.drizzle, ctx, input),
      ]);
      const lastEntry = current.at(-1);
      if (current.length >= maxEntries && lastEntry) {
        await deleteDamageSimulationForCreateDamageSimulation(
          ctx.drizzle,
          ctx,
          lastEntry,
        );
      }
      return { success: true, message: "Damage simulation saved" };
    }),
  updateDamageSimulation: protectedProcedure
    .meta({
      mcp: { description: "Update damage simulation active state" },
    })
    .input(z.object({ id: z.string().optional(), active: z.boolean() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      if (input.id) {
        await updateDamageSimulationForUpdateDamageSimulation(
          ctx.drizzle,
          { active: input.active, id: input.id },
          ctx,
        );
      } else {
        await updateDamageSimulationForUpdateDamageSimulation2(ctx.drizzle, input, ctx);
      }
      return { success: true, message: "Damage simulation updated" };
    }),
  deleteDamageSimulation: protectedProcedure
    .meta({ mcp: { description: "Delete a damage simulation" } })
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const entry = await fetchEntry(ctx.drizzle, input.id, ctx.userId);
      const result = await deleteDamageSimulationForDeleteDamageSimulation(
        ctx.drizzle,
        entry,
      );
      if (result.rowsAffected === 0) {
        throw serverError("NOT_FOUND", "Entry not found");
      }
      return { success: true, message: "Damage simulation deleted" };
    }),
});

/**
 * Load a simulation or throw NOT_FOUND. A truthy owner ID also requires ownership;
 * omitting it preserves public reads, while mismatches throw UNAUTHORIZED.
 */
const fetchEntry = async (client: DrizzleClient, id: string, userId?: string) => {
  const entry = await findDamageSimulationById(client, id);
  if (!entry) {
    throw serverError("NOT_FOUND", "Entry not found");
  }
  if (userId && entry.userId !== userId) {
    throw serverError("UNAUTHORIZED", "Not allowed to access entry");
  }
  return entry;
};
