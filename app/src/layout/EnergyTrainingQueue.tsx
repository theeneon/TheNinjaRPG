"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type CombatStatName, CombatStatNames } from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import { showMutationToast } from "@/libs/toast";
import { statTrainingBlockMessage } from "@/libs/train";
import type { UserWithRelations } from "@/routers/profile";
import { getQueueTotalCapacity } from "@/utils/paypal";

export const EnergyTrainingQueue = ({
  user,
  getGuess,
}: {
  user: NonNullable<UserWithRelations>;
  getGuess: () => string;
}) => {
  const utils = api.useUtils();
  const [stat, setStat] = useState<CombatStatName>("offence");
  const [energy, setEnergy] = useState(user.maxEnergy);
  const [error, setError] = useState<string | null>(null);
  const entries = user.energyTrainingQueue ?? [];
  const capacity = getQueueTotalCapacity(user);
  const block = statTrainingBlockMessage({
    ...user,
    status: user.status === "ASLEEP" ? "AWAKE" : user.status,
  });
  const { mutate: saveQueue, isPending } =
    api.train.updateEnergyTrainingQueue.useMutation({
      onSuccess: async (result) => {
        showMutationToast(result);
        setError(result.success ? null : result.message);
        await utils.profile.getUser.invalidate();
      },
      onError: (cause) => setError(cause.message),
    });
  useEffect(() => {
    if (!entries.length) return;
    const timer = setInterval(() => void utils.profile.getUser.invalidate(), 60_000);
    return () => clearInterval(timer);
  }, [entries.length, utils]);

  return (
    <ContentBox
      title="Energy queue"
      subtitle="Each entry trains once. Works offline and while sleeping."
      initialBreak
    >
      <div className="space-y-3">
        <p className="text-muted-foreground text-xs">
          Entries run in order when enough Energy is available. Capped stats are
          skipped; unused Energy is kept. {entries.length} / {capacity} slots used.
        </p>
        {entries.length > 0 ? (
          <ol className="divide-y divide-orange-900/20 rounded border border-orange-900/30">
            {entries.map((entry, index) => (
              <li
                key={`${index}-${entry.stat}-${entry.energy}`}
                className="flex items-center gap-2 px-3 py-2 text-sm"
              >
                <span className="text-muted-foreground">{index + 1}.</span>
                <span className="flex-1 capitalize">
                  {entry.stat}{" "}
                  <span className="text-muted-foreground">
                    · {entry.energy.toLocaleString()} Energy
                  </span>
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove queue entry ${index + 1}`}
                  disabled={isPending}
                  onClick={() =>
                    saveQueue({
                      expectedEntries: entries,
                      entries: entries.filter((_, i) => i !== index),
                      guess: getGuess(),
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-muted-foreground text-sm">Your queue is empty.</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={stat}
            onValueChange={(value) => setStat(value as CombatStatName)}
            disabled={isPending}
          >
            <SelectTrigger aria-label="Queued stat" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CombatStatNames.map((value) => (
                <SelectItem key={value} value={value} className="capitalize">
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            aria-label="Queued Energy"
            type="number"
            min={1}
            max={user.maxEnergy}
            step={1}
            value={energy}
            onChange={(event) => setEnergy(Number(event.target.value))}
            disabled={isPending}
            className="w-24"
          />
          <span className="text-muted-foreground text-xs">Energy</span>
          <Button
            size="sm"
            disabled={
              isPending ||
              !!block ||
              entries.length >= capacity ||
              !Number.isFinite(energy) ||
              energy <= 0 ||
              energy > user.maxEnergy
            }
            onClick={() =>
              saveQueue({
                expectedEntries: entries,
                entries: [...entries, { stat, energy }],
                guess: getGuess(),
              })
            }
          >
            Add to queue
          </Button>
          {entries.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => saveQueue({ expectedEntries: entries, entries: [] })}
            >
              Clear
            </Button>
          )}
        </div>
        {block && (
          <p className="text-muted-foreground text-xs">Queue paused: {block}</p>
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </div>
    </ContentBox>
  );
};
