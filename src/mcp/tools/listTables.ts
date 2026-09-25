import { TableInfo } from "../../db/types";
import { DatabaseTarget, resolveDatabase } from "./database";
import { z } from "zod";
import { TTLCache, getCacheTTL } from "../../utils/cache";

const listTablesCache = new TTLCache<TableInfo[]>(getCacheTTL());
const listTablesInputSchema = { database: z.string().min(1).optional().describe("Database to inspect; omit to use the default") };

export function registerListTablesTool(server: {
  registerTool: (
    name: string,
    config: { description?: string; inputSchema: typeof listTablesInputSchema },
    handler: (args: { database?: string }) => Promise<{
      content: Array<{ type: "text"; text: string }>;
    }>
  ) => void;
}, databases: DatabaseTarget): void {
  server.registerTool(
    "listTables",
    {
      description: "List all base tables in the database, returning their schema and name.",
      inputSchema: listTablesInputSchema,
    },
    async ({ database }) => {
      const db = await resolveDatabase(databases, database);
      const CACHE_KEY = `listTables:${database ?? "@default"}`;
      const cached = listTablesCache.get(CACHE_KEY);
      if (cached) {
        return { content: [{ type: "text", text: JSON.stringify(cached) }] };
      }

      const tables = await db.listTables();
      listTablesCache.set(CACHE_KEY, tables);

      return {
        content: [{ type: "text", text: JSON.stringify(tables) }],
      };
    }
  );
}
