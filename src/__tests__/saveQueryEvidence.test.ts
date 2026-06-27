import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DBAdapter, QueryResult, TableDescription, TableInfo } from "../db/types";
import { registerSaveQueryEvidenceTool } from "../mcp/tools/saveQueryEvidence";

function makeAdapter(
  rows: Record<string, unknown>[],
  streamImpl?: (sql: string, signal?: AbortSignal) => AsyncGenerator<Record<string, unknown>>
): DBAdapter {
  const streamRows = streamImpl ?? (async function* (): AsyncGenerator<Record<string, unknown>> {
    for (const row of rows) {
      yield row;
    }
  });

  return {
    query: async (): Promise<QueryResult> => ({ rows, totalCount: rows.length }),
    queryStream: streamRows,
    listTables: async (): Promise<TableInfo[]> => [],
    describeTable: async (): Promise<TableDescription> => ({
      table: { name: "t", schema: "dbo", rowCount: 0, dataSizeBytes: 0, indexSizeBytes: 0, totalSizeBytes: 0 },
      columns: [],
      indexes: [],
      constraints: [],
      foreignKeys: [],
    }),
    explainQuery: async () => ({ sql: "SELECT 1", plan: [] }),
    close: async () => undefined,
  };
}

type Handler = (args: { sql: string; filepath: string }) => Promise<{
  content: Array<{ type: "text"; text: string }>;
}>;

function captureHandler(db: DBAdapter): Handler {
  let captured: Handler | undefined;
  const fakeServer = {
    registerTool: (_name: string, _config: unknown, handler: Handler) => {
      captured = handler;
    },
  };

  registerSaveQueryEvidenceTool(fakeServer, db);
  if (!captured) {
    throw new Error("handler not registered");
  }
  return captured;
}

describe("saveQueryEvidence tool", () => {
  it("writes a markdown report and returns metadata", async () => {
    const db = makeAdapter([{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]);
    const handler = captureHandler(db);

    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "save-query-evidence-"));
    const filepath = path.join(tempDir, "evidence.md");

    try {
      const result = await handler({ sql: "SELECT id, name FROM users", filepath });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");

      const parsed = JSON.parse(result.content[0].text) as {
        filepath: string;
        rowCount: number;
        previewRows: Array<Record<string, unknown>>;
      };
      expect(parsed.filepath).toBe(filepath);
      expect(parsed.rowCount).toBe(2);
      expect(parsed.previewRows).toHaveLength(2);

      const markdown = await fs.promises.readFile(filepath, "utf8");
      expect(markdown).toContain("# SQL Query Evidence");
      expect(markdown).toContain("SELECT id, name FROM users");
      expect(markdown).toContain("| id | name |");
      expect(markdown).toContain("| 1 | Alice |");
      expect(markdown).toContain("| 2 | Bob |");
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns the SQL validation error as a message", async () => {
    const db = makeAdapter([]);
    const handler = captureHandler(db);

    const result = await handler({ sql: "DELETE FROM users", filepath: "/tmp/out.md" });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toContain("Only SELECT statements are allowed");
    await expect(fs.promises.access("/tmp/out.md")).rejects.toThrow();
  });

  it("returns a timeout message and cleans up the temp file when the query is aborted", async () => {
    const previousExportTimeout = process.env.EXPORT_QUERY_TIMEOUT;
    process.env.EXPORT_QUERY_TIMEOUT = "1";

    const db = makeAdapter([], async function* (_sql, signal?: AbortSignal): AsyncGenerator<Record<string, unknown>> {
      while (!signal?.aborted) {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("aborted");
    });
    const handler = captureHandler(db);

    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "save-query-timeout-"));
    const filepath = path.join(tempDir, "evidence.md");

    try {
      const result = await handler({ sql: "SELECT 1", filepath });
      expect(result.content[0].text).toContain("Query execution timed out");
      await expect(fs.promises.access(`${filepath}.tmp`)).rejects.toThrow();
    } finally {
      process.env.EXPORT_QUERY_TIMEOUT = previousExportTimeout;
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });
});
