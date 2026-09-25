import { DBProvider } from "../../db/types";

export function registerListDatabasesTool(server: {
  registerTool: (
    name: string,
    config: { description?: string; inputSchema: Record<string, never> },
    handler: (args: Record<string, never>) => Promise<{ content: Array<{ type: "text"; text: string }> }>
  ) => void;
}, databases: DBProvider): void {
  server.registerTool(
    "listDatabases",
    {
      description: "List databases available to the tools. isDefault identifies the database used when database is omitted.",
      inputSchema: {},
    },
    async () => ({ content: [{ type: "text", text: JSON.stringify(await databases.listDatabases()) }] })
  );
}
