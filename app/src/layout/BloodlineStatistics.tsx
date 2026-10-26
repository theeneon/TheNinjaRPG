import type { ChartData, Chart as ChartJS, ChartOptions } from "chart.js";
import { BarChart2, Bug } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface BloodlineStatisticsProps {
  trigger?: React.ReactNode;
}

export const BloodlineStatistics: React.FC<BloodlineStatisticsProps> = ({
  trigger,
}) => {
  const [open, setOpen] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const { data, isLoading } = api.bloodline.getNaturalRollStatistics.useQuery(
    undefined,
    { enabled: open },
  );

  // Format data for chart - calculate percentages
  const chartData = useMemo(() => {
    if (!data) return [];
    // Calculate total including "none" entries but excluding "H" rank
    const filteredData = Object.entries(data).filter(([rank]) => rank !== "H");
    const total = filteredData.reduce((sum, [_, count]) => sum + Number(count), 0);

    // Include all entries including "none" but excluding "H" rank
    return filteredData
      .map(([rank, count]) => ({
        rank,
        count: Number(count),
        percentage: total > 0 ? (Number(count) / total) * 100 : 0,
      }))
      .sort((a, b) => {
        // Sort by rank: S, A, B, C, D, none (at the end)
        const rankOrder: Record<string, number> = {
          S: 0,
          A: 1,
          B: 2,
          C: 3,
          D: 4,
          none: 5,
        };
        return (rankOrder[a.rank] ?? 999) - (rankOrder[b.rank] ?? 999);
      });
  }, [data]);

  // Calculate total rolls including "none" entries
  const totalRolls = data
    ? Object.values(data).reduce((sum, count) => sum + Number(count), 0)
    : 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger || (
          <BarChart2 className="h-6 w-6 cursor-pointer hover:text-orange-500" />
        )}
      </PopoverTrigger>
      <PopoverContent className="w-[350px] md:w-[450px]" align="end">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-lg">Bloodline Roll Statistics</h3>
              <p className="text-muted-foreground text-sm">
                Distribution of natural bloodline rolls by rank
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowDebug(!showDebug)}
              className="h-8 w-8"
            >
              <Bug className="h-4 w-4" />
            </Button>
          </div>

          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <p>Loading statistics...</p>
            </div>
          ) : !data || totalRolls === 0 ? (
            <div className="flex h-40 items-center justify-center">
              <p className="text-center text-gray-500">
                No roll statistics available yet
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span>Total bloodline rolls:</span>
                  <span className="font-semibold">{totalRolls}</span>
                </div>

                {showDebug && (
                  <div className="mt-2 max-h-40 overflow-auto rounded bg-gray-100 p-2 text-xs">
                    <p className="font-semibold">Raw Data:</p>
                    <pre>{JSON.stringify(data, null, 2)}</pre>
                    <p className="mt-2 font-semibold">Processed Data:</p>
                    <pre>{JSON.stringify(chartData, null, 2)}</pre>
                  </div>
                )}
              </div>

              {open && <BloodlineRollChart chartData={chartData} />}

              <div className="text-gray-500 text-xs italic">
                Statistics based on all natural bloodline rolls in the game
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

const BloodlineRollChart: React.FC<{ chartData: BloodlineChartDatum[] }> = ({
  chartData,
}) => {
  const chartRef = useRef<HTMLCanvasElement>(null);
  const [chartFailed, setChartFailed] = useState(false);

  useEffect(() => {
    const ctx = chartRef.current?.getContext("2d");
    if (!ctx || chartData.length === 0) return;

    let chart: ChartJS | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { Chart } = await import("chart.js/auto");
        // The popover can close before the library finishes loading.
        if (cancelled) return;
        // Prepare chart data
        const chartConfig: ChartData = {
          labels: chartData.map((item) =>
            item.rank === "none" ? "No Bloodline" : `${item.rank}-Rank`,
          ),
          datasets: [
            {
              label: "Percentage",
              data: chartData.map((item) => parseFloat(item.percentage.toFixed(2))),
              backgroundColor: chartData.map((item) => {
                // Color based on rank
                switch (item.rank) {
                  case "S":
                    return "rgba(255, 99, 132, 0.7)"; // Red
                  case "A":
                    return "rgba(255, 159, 64, 0.7)"; // Orange
                  case "B":
                    return "rgba(255, 205, 86, 0.7)"; // Yellow
                  case "C":
                    return "rgba(75, 192, 192, 0.7)"; // Green
                  case "D":
                    return "rgba(54, 162, 235, 0.7)"; // Blue
                  case "none":
                    return "rgba(201, 203, 207, 0.7)"; // Grey
                  default:
                    return "rgba(201, 203, 207, 0.7)"; // Grey
                }
              }),
              borderColor: chartData.map((item) => {
                // Border color based on rank
                switch (item.rank) {
                  case "S":
                    return "rgb(255, 99, 132)";
                  case "A":
                    return "rgb(255, 159, 64)";
                  case "B":
                    return "rgb(255, 205, 86)";
                  case "C":
                    return "rgb(75, 192, 192)";
                  case "D":
                    return "rgb(54, 162, 235)";
                  case "none":
                    return "rgb(201, 203, 207)";
                  default:
                    return "rgb(201, 203, 207)";
                }
              }),
              borderWidth: 1,
            },
          ],
        };

        // Chart options
        const options: ChartOptions = {
          responsive: true,
          maintainAspectRatio: true,
          aspectRatio: 1,
          plugins: {
            legend: {
              display: false,
            },
            tooltip: {
              callbacks: {
                label: (context) => {
                  const index = context.dataIndex;
                  const item = chartData[index];
                  if (!item) return "";
                  return [
                    `Percentage: ${item.percentage.toFixed(2)}%`,
                    `Count: ${item.count}`,
                  ];
                },
              },
            },
          },
          scales: {
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: "Percentage (%)",
              },
              ticks: {
                callback: (value) => `${value}%`,
              },
            },
          },
        };

        chart = new Chart(ctx, {
          type: "bar",
          data: chartConfig,
          options,
        });
      } catch (error) {
        console.error("Could not load the bloodline statistics chart", error);
        if (!cancelled) setChartFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      chart?.destroy();
    };
  }, [chartData]);

  return (
    <div className="aspect-square w-full">
      {chartFailed ? (
        <p role="alert" className="py-4 text-center text-muted-foreground text-sm">
          The statistics chart could not be loaded. Close and reopen to try again.
        </p>
      ) : (
        <canvas ref={chartRef} />
      )}
    </div>
  );
};

type BloodlineChartDatum = {
  rank: string;
  count: number;
  percentage: number;
};
