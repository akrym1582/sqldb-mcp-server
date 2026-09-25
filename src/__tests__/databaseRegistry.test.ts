import { parseDatabaseSelectors } from "../db";
import { registerQueryTool } from "../mcp/tools/query";
import { DBAdapter, DBProvider } from "../db/types";

describe("multi-database configuration", () => {
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
});
