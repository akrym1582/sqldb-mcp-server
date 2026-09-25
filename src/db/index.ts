import { DBAdapter, DatabaseInfo, DBProvider } from "./types";
import { MSSQLAdapter } from "./adapters/mssql";
import { PostgreSQLAdapter } from "./adapters/postgresql";
import { MySQLAdapter } from "./adapters/mysql";

function adapterFor(databaseName: string | undefined): DBAdapter {
  const dbType = (process.env.DB_TYPE ?? "mssql").toLowerCase();

  switch (dbType) {
    case "mssql":
      return new MSSQLAdapter(databaseName);
    case "postgresql":
      return new PostgreSQLAdapter(databaseName);
    case "mysql":
      return new MySQLAdapter(databaseName);
    default:
      throw new Error(
        `Unsupported DB_TYPE: "${dbType}". Supported types: mssql, postgresql, mysql`
      );
  }
}

export function createDBAdapter(databaseName: string | undefined = process.env.DB_NAME): DBAdapter {
  return adapterFor(databaseName);
}

type DatabaseSelector = { exact: string[]; patterns: RegExp[] };

export function parseDatabaseSelectors(value = process.env.DB_NAME ?? ""): DatabaseSelector {
  const exact: string[] = [];
  const patterns: RegExp[] = [];
  for (const item of value.split(",").map((part) => part.trim()).filter(Boolean)) {
    if (item.startsWith("/") && item.lastIndexOf("/") > 0) {
      const end = item.lastIndexOf("/");
      try {
        patterns.push(new RegExp(item.slice(1, end), item.slice(end + 1)));
      } catch (error) {
        throw new Error(`Invalid DB_NAME regular expression "${item}": ${(error as Error).message}`);
      }
    } else {
      exact.push(item);
    }
  }
  return { exact: [...new Set(exact)], patterns };
}

export class DatabaseRegistry implements DBProvider {
  private readonly selectors = parseDatabaseSelectors();
  private readonly adapters = new Map<string, DBAdapter>();
  private discoveredNames: Promise<string[]> | null = null;

  private async allowedNames(): Promise<string[]> {
    if (!this.discoveredNames) {
      this.discoveredNames = (async () => {
        if (this.selectors.patterns.length === 0) return this.selectors.exact;
        // With a regex-only selector, connect without a database so the server can enumerate catalogs.
        const discovery = adapterFor(this.selectors.exact[0]);
        try {
          const visible = await discovery.listDatabases();
          const matched = visible.filter((name) =>
            this.selectors.patterns.some((pattern) => {
              pattern.lastIndex = 0;
              return pattern.test(name);
            })
          );
          return [...new Set([...this.selectors.exact, ...matched])];
        } finally {
          await discovery.close();
        }
      })();
    }
    return this.discoveredNames;
  }

  private async defaultName(): Promise<string> {
    const names = await this.allowedNames();
    const configured = process.env.DB_DEFAULT?.trim();
    const name = configured || names[0];
    if (!name) throw new Error("DB_NAME must contain at least one database name or regular expression");
    if (!names.includes(name)) throw new Error(`DB_DEFAULT database "${name}" is not allowed by DB_NAME`);
    return name;
  }

  async getAdapter(database?: string): Promise<DBAdapter> {
    const name = database?.trim() || await this.defaultName();
    const allowed = await this.allowedNames();
    if (!allowed.includes(name)) {
      throw new Error(`Database "${name}" is not allowed. Use listDatabases to see available databases.`);
    }
    let adapter = this.adapters.get(name);
    if (!adapter) {
      adapter = createDBAdapter(name);
      this.adapters.set(name, adapter);
    }
    return adapter;
  }

  async listDatabases(): Promise<DatabaseInfo[]> {
    const [names, defaultName] = await Promise.all([this.allowedNames(), this.defaultName()]);
    return names.map((name) => ({ name, isDefault: name === defaultName }));
  }

  async close(): Promise<void> {
    await Promise.all([...this.adapters.values()].map((adapter) => adapter.close()));
  }
}

export * from "./types";
