const mockListDatabases = jest.fn();
const mockClose = jest.fn();

jest.mock("../db/adapters/mssql", () => ({
  MSSQLAdapter: jest.fn().mockImplementation(() => ({
    listDatabases: mockListDatabases,
    close: mockClose,
  })),
}));

import { DatabaseRegistry, parseDatabaseSelectors } from "../db";
import { registerQueryTool } from "../mcp/tools/query";
import { DBAdapter, DBProvider } from "../db/types";

describe("multi-database configuration", () => {
  const originalDbName = process.env.DB_NAME;

  afterEach(() => {
    jest.clearAllMocks();
    if (originalDbName === undefined) delete process.env.DB_NAME;
    else process.env.DB_NAME = originalDbName;
  });

  it("parses exact names and regular expressions", () => {
    const selectors = parseDatabaseSelectors("app, analytics, /^tenant_[0-9]+$/i,app");
    expect(selectors.exact).toEqual(["app", "analytics"]);
    expect(selectors.patterns).toHaveLength(1);
    expect(selectors.patterns[0].test("TENANT_42")).toBe(true);
    expect(selectors.patterns[0].test("private")).toBe(false);
  });

  it("reports invalid regular expressions during startup configuration", () => {
    expect(() => parseDatabaseSelectors("/[invalid/")).toThrow("Invalid DB_NAME regular expression");
  });

  it("routes a query to the selected database", async () => {
    const adapter = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: 1 }], totalCount: 1 }),
    } as unknown as DBAdapter;
    const provider = {
      getAdapter: jest.fn().mockResolvedValue(adapter),
    } as unknown as DBProvider;
    let handler: ((args: { sql: string; database?: string }) => Promise<unknown>) | undefined;
    const server = {
      registerTool: jest.fn((_name, _config, registeredHandler) => { handler = registeredHandler; }),
    };

    registerQueryTool(server as never, provider);
    await handler!({ sql: "SELECT * FROM users", database: "analytics" });

    expect(provider.getAdapter).toHaveBeenCalledWith("analytics");
    expect(adapter.query).toHaveBeenCalledWith("SELECT * FROM users", 0, 50);
  });

  it("retries database discovery after a transient failure", async () => {
    process.env.DB_NAME = "/^tenant_/";
    mockListDatabases
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce(["tenant_one", "private"]);
    mockClose.mockResolvedValue(undefined);
    const registry = new DatabaseRegistry();

    await expect(registry.listDatabases()).rejects.toThrow("database unavailable");
    await expect(registry.listDatabases()).resolves.toEqual([
      { name: "tenant_one", isDefault: true },
    ]);

    expect(mockListDatabases).toHaveBeenCalledTimes(2);
    expect(mockClose).toHaveBeenCalledTimes(2);
  });
});
