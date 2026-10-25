// A fake fetch that answers JSON-RPC by method and any other URL by prefix, so engine functions
// can be tested end to end without touching the network.
export function mockFetch(routes) {
  const calls = [];
  async function f(url, init) {
    let body = null;
    if (init && init.body) body = JSON.parse(init.body);
    calls.push({ url: url, method: body && body.method, params: body && body.params });
    let res;
    if (body && body.method) {
      const h = routes.rpc && routes.rpc[body.method];
      if (!h) return reply(200, { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "no mock for " + body.method } });
      res = h(body.params, url);
      if (res && res.__status) return reply(res.__status, {});
      return reply(200, { jsonrpc: "2.0", id: 1, result: res });
    }
    const key = Object.keys(routes.http || {}).find(function (p) { return url.indexOf(p) === 0; });
    if (!key) return reply(404, {});
    res = routes.http[key](url);
    if (res && res.__status) return reply(res.__status, {});
    return reply(200, res);
  }
  f.calls = calls;
  return f;
}

function reply(status, json) {
  return { status: status, ok: status >= 200 && status < 300, json: async function () { return json; } };
}

// Valid-looking addresses for fixtures
export const A = {
  mint: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  creator: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  acc1: "3Kz9mUDf2pJ8hZ2KjJvfPpqq7Eh1mZ5K8eJd4oJb5TbA",
  acc2: "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
  owner1: "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH",
  owner2: "CuieVDEDtLo7FypA9SbLM9saXFdb1dsshEkyErMqkRQq",
  wallet: "DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy"
};
