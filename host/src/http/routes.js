// API 路由：method + path 正则 → handler(runtime, ctx) → { status?, body }
export function createRoutes(runtime) {
  return [
    {
      method: 'GET',
      pattern: /^\/api\/health$/,
      handler: () => runtime.invoke({ op: 'ping' }),
    },
    {
      method: 'GET',
      pattern: /^\/api\/version$/,
      handler: () => runtime.invoke({ op: 'sys.version' }),
    },
    {
      method: 'GET',
      pattern: /^\/api\/system\/status$/,
      handler: () => {
        const uv = runtime.invoke({ op: 'db.user_version' });
        const tables = runtime.invoke({ op: 'db.tables' });
        return {
          code: 0,
          data: {
            wasm: runtime.version,
            user_version: uv.data?.user_version,
            tables: tables.data?.tables,
          },
        };
      },
    },
  ];
}
