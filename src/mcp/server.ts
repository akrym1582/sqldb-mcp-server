#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { DatabaseRegistry } from "../db";
import { registerQueryTool } from "./tools/query";
import { registerListTablesTool } from "./tools/listTables";
import { registerDescribeTableTool } from "./tools/describeTable";
import { registerExplainQueryTool } from "./tools/explainQuery";
import { registerExportQueryTool } from "./tools/exportQuery";
import { registerSaveQueryEvidenceTool } from "./tools/saveQueryEvidence";
import { registerListDatabasesTool } from "./tools/listDatabases";
import packageJson from "../../package.json";

async function main(): Promise<void> {
  const databases = new DatabaseRegistry();

  const server = new McpServer({
    name: "sqldb-mcp-server",
    version: packageJson.version,
  });

  registerListDatabasesTool(server, databases);
  registerQueryTool(server, databases);
  registerListTablesTool(server, databases);
  registerDescribeTableTool(server, databases);
  registerExplainQueryTool(server, databases);
  registerExportQueryTool(server, databases);
  registerSaveQueryEvidenceTool(server, databases);

  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    process.stderr.write(`Received ${signal}, shutting down...\n`);
    await server.close();
    await databases.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
