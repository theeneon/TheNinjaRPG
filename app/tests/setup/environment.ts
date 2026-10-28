/** Load before application imports so a fresh checkout needs no service credentials. */
const environment = process.env as Record<string, string | undefined>;
environment.NODE_ENV = "test";

const defaults = {
  NEXT_PUBLIC_PUSHER_APP_KEY: "test-key",
  NEXT_PUBLIC_PUSHER_APP_CLUSTER: "mt1",
  NEXT_PUBLIC_BASE_URL: "http://localhost:3000",
  PUSHER_APP_ID: "test-app",
  PUSHER_APP_SECRET: "test-secret",
  OPENAI_API_KEY: "test-placeholder-not-a-real-key",
  DATABASE_URL: "http://127.0.0.1:1",
  UPSTASH_REDIS_REST_URL: "http://127.0.0.1:1",
  UPSTASH_REDIS_REST_TOKEN: "test-token",
};

for (const [key, value] of Object.entries(defaults)) {
  environment[key] ??= value;
}
