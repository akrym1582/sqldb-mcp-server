import { Parser } from "node-sql-parser";

export const DEFAULT_SKIP = 0;
export const DEFAULT_TAKE = 50;
export const MAX_TAKE = 100;

const parser = new Parser();

function getDialect(): string {
  switch ((process.env.DB_TYPE ?? "mssql").toLowerCase()) {
    case "postgresql":
      return "PostgreSQL";
    case "mysql":
      return "MySQL";
    default:
      return "TransactSQL";
  }
}

type SelectNode = {
  top?: unknown;
  limit?: { value?: unknown[]; offset?: unknown; fetch?: unknown } | null;
  _next?: SelectNode;
};

/**
 * Returns whether the outer query already controls the number or position of
 * rows it returns. Pagination in a nested subquery or CTE does not count: the
 * query tool can still safely paginate the outer result in that case.
 */
export function hasExplicitPagination(sqlText: string): boolean {
  const ast = parser.astify(sqlText, { database: getDialect() }) as SelectNode | SelectNode[];
  const statements = Array.isArray(ast) ? ast : [ast];

  return statements.some((statement) => {
    let select: SelectNode | undefined = statement;
    while (select) {
      if (
        select.top != null ||
        (select.limit?.value?.length ?? 0) > 0 ||
        select.limit?.offset != null ||
        select.limit?.fetch != null
      ) {
        return true;
      }
      // node-sql-parser stores each subsequent SELECT in a UNION here. A
      // trailing LIMIT/OFFSET is attached to the final SELECT node.
      select = select._next;
    }
    return false;
  });
}

/**
 * Normalizes pagination parameters, clamping `take` to [1, MAX_TAKE].
 */
export function normalizePagination(
  skip: number | undefined,
  take: number | undefined
): { skip: number; take: number } {
  const normalizedSkip = Math.max(0, Math.floor(skip ?? DEFAULT_SKIP));
  const normalizedTake = Math.min(
    MAX_TAKE,
    Math.max(1, Math.floor(take ?? DEFAULT_TAKE))
  );
  return { skip: normalizedSkip, take: normalizedTake };
}
