import { DBAdapter, DBProvider } from "../../db/types";

export type DatabaseTarget = DBAdapter | DBProvider;

export async function resolveDatabase(target: DatabaseTarget, database?: string): Promise<DBAdapter> {
  return "getAdapter" in target ? target.getAdapter(database) : target;
}
