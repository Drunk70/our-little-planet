import type Database from "better-sqlite3";

export type LoginRole = "reader" | "author";
export type LoginVerdict =
  | { allowed: true; role: LoginRole }
  | { allowed: false; retryAfterSeconds: number };

export function loginIdentity(
  headers: Pick<Headers, "get">,
  options: { trustProxy?: boolean; secret: string },
): string;

export function createLoginRateLimit(database: Database.Database): {
  evaluate(identity: string, verify: () => LoginRole | null, now?: number): LoginVerdict;
};
