import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { compareRenderingBenchmarks } from "@/libs/rendering/compareBenchmarks";

const readRuns = async (path: string) => {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && "results" in value && Array.isArray(value.results)) return value.results;
  return [value];
};

const before = process.env.BENCHMARK_BEFORE;
const after = process.env.BENCHMARK_AFTER;
if (!before || !after) {
  throw new Error("Set BENCHMARK_BEFORE and BENCHMARK_AFTER to absolute JSON result paths");
}
const [beforeRuns, afterRuns] = await Promise.all([readRuns(before), readRuns(after)]);
const report = compareRenderingBenchmarks(beforeRuns, afterRuns);
const output = process.env.BENCHMARK_OUTPUT;
const json = `${JSON.stringify(report, null, 2)}\n`;
if (output) {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, json);
  console.log(`Wrote ${report.groups.length} workload comparison(s) to ${output}`);
} else console.log(json);
if (!report.comparable) {
  console.error("Comparison is incomplete or not controlled; inspect each group's issues before claiming improvement.");
  process.exitCode = 1;
}
