import { z } from "zod";
import { TableDescription } from "../../db/types";
import { DatabaseTarget, resolveDatabase } from "./database";
import { TTLCache, getCacheTTL } from "../../utils/cache";

const describeTableCache = new TTLCache<TableDescription>(getCacheTTL());

export const describeTableInputSchema = {
  table: z.string().min(1).describe(
    "Table name to describe. Optionally prefix with schema: 'schema.table'"
  ),
  database: z.string().min(1).optional().describe("Database containing the table; omit to use the default"),
};

export function registerDescribeTableTool(server: {
  registerTool: (
    name: string,
    config: {
      description?: string;
      inputSchema: typeof describeTableInputSchema;
    },
    handler: (args: { table: string; database?: string }) => Promise<{
      content: Array<{ type: "text"; text: string }>;
    }>
  ) => void;
}, databases: DatabaseTarget): void {
  server.registerTool(
    "describeTable",
    {
      description:
        "Describe a table: returns columns (name, type, nullability, primary key, identity), " +
        "indexes, foreign keys, check constraints, and table-level size/row-count statistics.",
      inputSchema: describeTableInputSchema,
    },
    async ({ table, database }) => {
      const db = await resolveDatabase(databases, database);
      const cacheKey = `describeTable:${database ?? "@default"}:${table}`;
      const cached = describeTableCache.get(cacheKey);
      if (cached) {
        return { content: [{ type: "text", text: JSON.stringify(cached) }] };
      }

      const description = await db.describeTable(table);
      describeTableCache.set(cacheKey, description);

      return {
        content: [{ type: "text", text: JSON.stringify(description) }],
      };
    }
  );
}
