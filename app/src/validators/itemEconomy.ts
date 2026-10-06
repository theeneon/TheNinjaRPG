import { z } from "zod";
import { ItemPurchaseLimitPeriods, MAX_ITEM_PURCHASE_LIMIT } from "@/drizzle/constants";

const nullableInteger = (min: number, max: number) =>
  z.preprocess(
    (value) => (value === "" || value == null ? null : value),
    z.coerce.number().int().min(min).max(max).nullable(),
  );

export const itemEconomySchema = z.object({
  auctionMinPrice: nullableInteger(0, 4_294_967_295),
  auctionMaxPrice: nullableInteger(0, 4_294_967_295),
  purchaseLimit: nullableInteger(1, MAX_ITEM_PURCHASE_LIMIT),
  purchaseLimitPeriod: z.enum(ItemPurchaseLimitPeriods).default("NONE"),
});

export const refineItemEconomy = (
  data: z.output<typeof itemEconomySchema>,
  ctx: z.RefinementCtx,
) => {
  if (
    data.auctionMinPrice != null &&
    data.auctionMaxPrice != null &&
    data.auctionMinPrice > data.auctionMaxPrice
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["auctionMaxPrice"],
      message: "Maximum auction price must be at least the minimum",
    });
  }
  if (data.purchaseLimitPeriod !== "NONE" && data.purchaseLimit == null) {
    ctx.addIssue({
      code: "custom",
      path: ["purchaseLimit"],
      message: `A limited period requires a quantity from 1 to ${MAX_ITEM_PURCHASE_LIMIT}`,
    });
  }
};
