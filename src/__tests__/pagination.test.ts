import {
  hasExplicitPagination,
  normalizePagination,
  DEFAULT_SKIP,
  DEFAULT_TAKE,
  MAX_TAKE,
} from "../utils/pagination";

describe("normalizePagination", () => {
  it("uses defaults when no arguments are provided", () => {
    const result = normalizePagination(undefined, undefined);
    expect(result.skip).toBe(DEFAULT_SKIP);
    expect(result.take).toBe(DEFAULT_TAKE);
  });

  it("uses provided values", () => {
    expect(normalizePagination(10, 25)).toEqual({ skip: 10, take: 25 });
  });

  it("clamps take to MAX_TAKE", () => {
    expect(normalizePagination(0, 999).take).toBe(MAX_TAKE);
  });

  it("ensures take is at least 1", () => {
    expect(normalizePagination(0, 0).take).toBe(1);
    expect(normalizePagination(0, -5).take).toBe(1);
  });

  it("ensures skip is non-negative", () => {
    expect(normalizePagination(-10, 10).skip).toBe(0);
  });

  it("floors fractional values", () => {
    expect(normalizePagination(1.9, 9.9)).toEqual({ skip: 1, take: 9 });
  });
});

describe("hasExplicitPagination", () => {
  const originalDbType = process.env.DB_TYPE;

  afterEach(() => {
    if (originalDbType === undefined) delete process.env.DB_TYPE;
    else process.env.DB_TYPE = originalDbType;
  });

  it.each([
    ["mssql", "SELECT TOP 10 * FROM logs"],
    ["mssql", "SELECT * FROM logs ORDER BY id OFFSET 5 ROWS FETCH NEXT 10 ROWS ONLY"],
    ["postgresql", "SELECT * FROM logs LIMIT 10 OFFSET 5"],
    ["postgresql", "SELECT * FROM logs OFFSET 5"],
    ["mysql", "SELECT * FROM logs LIMIT 5, 10"],
  ])("detects %s pagination", (dbType, sql) => {
    process.env.DB_TYPE = dbType;
    expect(hasExplicitPagination(sql)).toBe(true);
  });

  it("does not treat pagination in a nested query as outer pagination", () => {
    process.env.DB_TYPE = "postgresql";
    expect(hasExplicitPagination("SELECT * FROM (SELECT * FROM logs LIMIT 10) recent")).toBe(false);
    expect(hasExplicitPagination("WITH recent AS (SELECT * FROM logs LIMIT 10) SELECT * FROM recent")).toBe(false);
  });

  it("detects a trailing limit on a union", () => {
    process.env.DB_TYPE = "postgresql";
    expect(hasExplicitPagination("SELECT id FROM a UNION SELECT id FROM b LIMIT 10")).toBe(true);
  });
});
