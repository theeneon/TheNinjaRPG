import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "bun:test";
import reactCompiler, { type LoggerEvent } from "babel-plugin-react-compiler";

const require = createRequire(import.meta.url);
const { transformSync, parseSync } = require("next/dist/compiled/babel/core") as {
  transformSync: (source: string, options: unknown) => unknown;
  parseSync: (source: string, options: unknown) => unknown;
};

const targets = [
  ["layout/MenuBoxProfile.tsx", ["MenuBoxProfile", "useExpiryAnchor", "Cooldown"]],
  ["layout/Countdown.tsx", ["Countdown"]],
  ["layout/LowerRightHelpBtn.tsx", ["LowerRightHelpBtn"]],
  ["components/layout/shared/LayoutNotifications.tsx", ["MobileNotificationsPopover"]],
  ["hooks/tutorial.tsx", ["useTutorialStep"]],
  ["layout/TutorialAssistant.tsx", ["PlayerTutorialAssistant"]],
  ["app/[shell]/items/page.tsx", ["MyItems", "Backpack", "Character"]],
  ["app/[shell]/travel/page.tsx", ["StealthControls"]],
  ["app/[shell]/profile/experience/page.tsx", ["AssignExperience"]],
  ["app/[shell]/village/page.tsx", ["VillageOverview"]],
] as const;

describe("React Compiler coverage", () => {
  for (const [path, names] of targets) {
    it(`memoizes ${names.join(", ")}`, () => {
      const events: LoggerEvent[] = [];
      const source = readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");
      const parserOptions = { filename: path, configFile: false, babelrc: false, parserOpts: { plugins: ["typescript", "jsx"] } };
      const functionNames = collectFunctionNames(parseSync(source, parserOptions));
      // Next uses the compiler defaults; a skipped function still produces valid JS.
      // Assert successes by name so unrelated functions and line shifts do not hide regressions.
      transformSync(source, {
        ...parserOptions,
        plugins: [[reactCompiler, {
          logger: { logEvent: (_filename: string | null, event: LoggerEvent) => events.push(event) },
        }]],
      });
      const compiled = events.flatMap((event) => event.kind === "CompileSuccess"
        ? [event.fnName ?? functionNames.get(`${event.fnLoc?.start.line}:${event.fnLoc?.start.column}`)]
        : []);
      for (const name of names) expect(compiled).toContain(name);
    });
  }
});

/** Compiler events omit the binding name for arrow functions. Match their original AST locations. */
function collectFunctionNames(ast: unknown) {
  const names = new Map<string, string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const node = value as { type?: string; id?: { name?: string }; init?: { loc?: { start: { line: number; column: number } } } };
    if (node.type === "VariableDeclarator" && node.id?.name && node.init?.loc) {
      const { line, column } = node.init.loc.start;
      names.set(`${line}:${column}`, node.id.name);
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  };
  visit(ast);
  return names;
}
