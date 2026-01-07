declare module 'sql.js' {
  interface SqlJsStatic {
    Database: DatabaseConstructor;
  }

  interface DatabaseConstructor {
    new (data?: ArrayLike<number>): Database;
  }

  interface Database {
    run(sql: string, params?: unknown[]): void;
    exec(sql: string): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }

  interface Statement {
    bind(params?: unknown[]): void;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  }

  interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }

  function initSqlJs(): Promise<SqlJsStatic>;
  
  export default initSqlJs;
  export { Database, Statement, SqlJsStatic, QueryExecResult };
}

