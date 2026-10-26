import { AsyncLocalStorage } from "node:async_hooks";

type AfterTask = () => unknown;

/** Each direct router invocation owns its deferred response work, including concurrent calls. */
export const afterTasks = new AsyncLocalStorage<AfterTask[]>();

/** Direct callers have no HTTP response; finish their deferred writes before SQL assertions. */
export const withAfterTasks = <Caller>(caller: Caller): Caller => {
  const wrap = (target: object): object =>
    new Proxy(target, {
      get(object, property, receiver) {
        const value = Reflect.get(object, property, receiver);
        return value && (typeof value === "function" || typeof value === "object")
          ? wrap(value)
          : value;
      },
      async apply(object, thisArg, args) {
        const tasks: AfterTask[] = [];
        return afterTasks.run(tasks, async () => {
          try {
            return await Reflect.apply(
              object as (...args: unknown[]) => unknown,
              thisArg,
              args,
            );
          } finally {
            for (const task of tasks) await task();
          }
        });
      },
    });
  return wrap(caller as object) as Caller;
};
