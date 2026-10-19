import type { DatabaseParameter, DatabaseRow } from '../types.js';

export interface DatabaseDriver {
  select(
    sql: string,
    params: readonly DatabaseParameter[],
  ): Promise<DatabaseRow[]>;
  execute(sql: string, params: readonly DatabaseParameter[]): Promise<number>;
  close(): Promise<void>;
}
