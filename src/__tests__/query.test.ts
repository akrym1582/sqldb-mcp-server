import { registerQueryTool } from "../mcp/tools/query";
import { DBAdapter } from "../db/types";

describe("query tool pagination", () => {
  const originalDbType = process.env.DB_TYPE;

  afterEach(() => {
    if (originalDbType === undefined) delete process.env.DB_TYPE;
    else process.env.DB_TYPE = originalDbType;
  });

  function getHandler(db: DBAdapter) {
    let handler: ((args: { sql: string; skip?: number; take?: number }) => Promise<unknown>) | undefined;
    const server = {
      registerTool: jest.fn((_name, _config, registeredHandler) => {
        handler = registeredHandler;
      }),
    };
    registerQueryTool(server as any, db);
    return handler!;
  }

  it("does not add tool pagination when SQL already has pagination", async () => {
    process.env.DB_TYPE = "postgresql";
    const db = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: 1 }], totalCount: 1 }),
    } as unknown as DBAdapter;

    await getHandler(db)({ sql: "SELECT * FROM users LIMIT 1", skip: 20, take: 30 });

    expect(db.query).toHaveBeenCalledWith("SELECT * FROM users LIMIT 1");
  });

  it("adds normalized tool pagination when SQL has none", async () => {
    process.env.DB_TYPE = "postgresql";
    const db = {
      query: jest.fn().mockResolvedValue({ rows: [], totalCount: 0 }),
    } as unknown as DBAdapter;

    await getHandler(db)({ sql: "SELECT * FROM users", skip: 20, take: 30 });

    expect(db.query).toHaveBeenCalledWith("SELECT * FROM users", 20, 30);
  });
});
