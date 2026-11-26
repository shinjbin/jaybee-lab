function snapshotDb(initial = []) {
  const snapshots = new Map(initial.map((row) => [row.symbol, row]));
  return {
    snapshots,
    query: async (sql, params) => {
      if (sql.startsWith('SELECT')) return { rows: [...snapshots.values()].filter((row) => params[0].includes(row.symbol)) };
      if (sql.startsWith('INSERT')) {
        const [symbol, payload, refreshedAt] = params;
        const previous = snapshots.get(symbol);
        if (!previous || Date.parse(previous.refreshed_at) <= Date.parse(refreshedAt)) {
          snapshots.set(symbol, { symbol, payload: JSON.parse(payload), refreshed_at: refreshedAt });
        }
        return { rows: [] };
      }
      throw new Error('Unexpected snapshot query');
    }
  };
}
module.exports = { snapshotDb };
