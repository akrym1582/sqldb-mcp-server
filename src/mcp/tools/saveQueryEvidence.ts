import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { DBAdapter } from "../../db/types";
import { validateSQL } from "../../utils/sanitize";

const DEFAULT_EXPORT_TIMEOUT_MS = 300_000; // 5 minutes

export const saveQueryEvidenceInputSchema = {
  sql: z.string().min(1).describe("SELECT SQL statement to execute and document"),
  filepath: z
    .string()
    .min(1)
    .describe("Destination Markdown file path (absolute, or relative to the server working directory)"),
};

type SaveQueryEvidenceArgs = {
  sql: string;
  filepath: string;
};

function formatMarkdownValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value.replace(/\r?\n/g, "<br>");
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function finishWriteStream(writeStream: fs.WriteStream): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    writeStream.once("finish", () => resolve());
    writeStream.once("error", (err) => reject(err));
    writeStream.end();
  });
}

function closeWriteStream(writeStream: fs.WriteStream): Promise<void> {
  return new Promise<void>((resolve) => {
    if (writeStream.destroyed) {
      resolve();
      return;
    }
    writeStream.once("close", () => resolve());
    writeStream.destroy();
  });
}

export function registerSaveQueryEvidenceTool(
  server: {
    registerTool: (
      name: string,
      config: {
        description?: string;
        inputSchema: typeof saveQueryEvidenceInputSchema;
      },
      handler: (args: SaveQueryEvidenceArgs) => Promise<{
        content: Array<{ type: "text"; text: string }>;
      }>
    ) => void;
  },
  db: DBAdapter
): void {
  server.registerTool(
    "saveQueryEvidence",
    {
      description:
        "Execute a read-only SELECT SQL query and save the SQL plus the results as a Markdown report file. " +
        "Returns the saved file path, the total number of rows fetched, and the first 10 rows as preview data.",
      inputSchema: saveQueryEvidenceInputSchema,
    },
    async ({ sql, filepath }) => {
      let controller: AbortController | null = null;
      let exportTimeout = DEFAULT_EXPORT_TIMEOUT_MS;
      let timeoutId: NodeJS.Timeout | null = null;
      let resolvedPath = "";
      let tempPath = "";
      let writeStream: fs.WriteStream | null = null;

      try {
        validateSQL(sql);

        controller = new AbortController();
        exportTimeout = Number(process.env.EXPORT_QUERY_TIMEOUT) || DEFAULT_EXPORT_TIMEOUT_MS;
        timeoutId = setTimeout(() => controller?.abort(), exportTimeout);

        resolvedPath = path.isAbsolute(filepath)
          ? filepath
          : path.resolve(process.cwd(), filepath);
        tempPath = `${resolvedPath}.tmp`;

        await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });

        writeStream = fs.createWriteStream(tempPath, { encoding: "utf8" });
        const previewRows: Record<string, unknown>[] = [];
        let rowCount = 0;
        let columns: string[] | null = null;
        let tableStarted = false;

        const writeLine = (line: string): void => {
          if (writeStream) {
            writeStream.write(line + "\n");
          }
        };

        writeLine("# SQL Query Evidence");
        writeLine("");
        writeLine("## SQL");
        writeLine("");
        writeLine("```sql");
        writeLine(sql);
        writeLine("```");
        writeLine("");
        writeLine("## Result");
        writeLine("");

        for await (const row of db.queryStream(sql, controller.signal)) {
          rowCount++;
          if (previewRows.length < 10) {
            previewRows.push(row);
          }

          if (!tableStarted) {
            columns = Object.keys(row);
            if (columns.length > 0) {
              writeLine(`| ${columns.join(" | ")} |`);
              writeLine(`| ${columns.map(() => "---").join(" | ")} |`);
            }
            tableStarted = true;
          }

          if (columns && columns.length > 0) {
            writeLine(`| ${columns.map((column) => formatMarkdownValue(row[column])).join(" | ")} |`);
          }
        }

        if (!tableStarted) {
          writeLine("No rows returned.");
        }

        if (writeStream) {
          await finishWriteStream(writeStream);
          await fs.promises.rename(tempPath, resolvedPath);
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                filepath: resolvedPath,
                rowCount,
                previewRows,
              }),
            },
          ],
        };
      } catch (err) {
        if (writeStream) {
          await closeWriteStream(writeStream);
        }

        if (tempPath) {
          try {
            await fs.promises.unlink(tempPath);
          } catch {
            // Ignore cleanup failures
          }
        }

        if (controller?.signal.aborted) {
          return {
            content: [
              {
                type: "text",
                text: `Query execution timed out after ${exportTimeout / 1000}s. Increase EXPORT_QUERY_TIMEOUT or narrow the query.`,
              },
            ],
          };
        }

        return {
          content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
        };
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    }
  );
}
