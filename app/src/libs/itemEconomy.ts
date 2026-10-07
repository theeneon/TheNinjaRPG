import type { TradeableCurrencyType } from "@/drizzle/constants";
import type { Item } from "@/drizzle/schema";
import { getItemPurchasePeriodStart } from "@/utils/time";

export const getAuctionPriceError = (
  item: Pick<Item, "canBeTraded" | "auctionMinPrice" | "auctionMaxPrice">,
  listingType: "AUCTION" | "DIRECT",
  price: number,
  quantity: number,
  currencyType: TradeableCurrencyType,
) => {
  if (listingType !== "AUCTION" || !item.canBeTraded || currencyType !== "MONEY")
    return null;
  if (item.auctionMinPrice != null && price < item.auctionMinPrice * quantity) {
    return `Price must be at least ${item.auctionMinPrice} ryo per unit`;
  }
  if (item.auctionMaxPrice != null && price > item.auctionMaxPrice * quantity) {
    return `Price must be at most ${item.auctionMaxPrice} ryo per unit`;
  }
  return null;
};

export const getItemPurchaseAllowance = (
  item: Pick<Item, "purchaseLimit" | "purchaseLimitPeriod">,
  counters: { periodStart: Date; quantity: number }[],
  now = new Date(),
) => {
  const periodStart = getItemPurchasePeriodStart(item.purchaseLimitPeriod, now);
  const purchased = periodStart
    ? (counters.find((row) => row.periodStart.getTime() === periodStart.getTime())
        ?.quantity ?? 0)
    : 0;
  const limit = periodStart ? item.purchaseLimit : null;
  return {
    period: item.purchaseLimitPeriod,
    periodStart,
    limit,
    purchased,
    remaining: limit == null ? null : Math.max(0, limit - purchased),
  };
};

export const itemPurchaseLimitMessage = (
  allowance: ReturnType<typeof getItemPurchaseAllowance>,
) =>
  `Purchase limit: ${allowance.limit} units ${allowance.period.toLowerCase()}; ${allowance.remaining} remaining. Please refresh and try again.`;
