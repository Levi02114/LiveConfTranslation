import type { SQLOutputValue } from "node:sqlite";

import { z } from "zod";

type SqlRow = Record<string, SQLOutputValue>;

export class SqlDataIntegrityError extends Error {
  constructor(context: string, error: z.ZodError) {
    super(`SQLite 데이터가 ${context} 형식과 맞지 않습니다: ${z.prettifyError(error)}`);
    this.name = "SqlDataIntegrityError";
  }
}

export function parseSqlRow<S extends z.ZodType>(
  schema: S,
  row: SqlRow | undefined,
  context: string,
): z.output<S> | undefined {
  if (!row) return undefined;
  const parsed = schema.safeParse(row);
  if (!parsed.success) throw new SqlDataIntegrityError(context, parsed.error);
  return parsed.data;
}

export function parseRequiredSqlRow<S extends z.ZodType>(
  schema: S,
  row: SqlRow | undefined,
  context: string,
): z.output<S> {
  const parsed = schema.safeParse(row);
  if (!parsed.success) throw new SqlDataIntegrityError(context, parsed.error);
  return parsed.data;
}

export function parseSqlRows<S extends z.ZodType>(
  schema: S,
  rows: SqlRow[],
  context: string,
): z.output<S>[] {
  return rows.map((row) => {
    const parsed = schema.safeParse(row);
    if (!parsed.success) throw new SqlDataIntegrityError(context, parsed.error);
    return parsed.data;
  });
}
