export function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

export function short(a) {
  return a.slice(0, 4) + "…" + a.slice(-4);
}

// Runs fn over items with at most n in flight
export async function pool(items, n, fn) {
  let i = 0;
  const workers = [];
  for (let w = 0; w < Math.min(n, items.length); w++) {
    workers.push((async function () {
      while (i < items.length) { const k = i++; await fn(items[k], k); }
    })());
  }
  await Promise.all(workers);
}

export function uniq(list) {
  return list.filter(function (x, i) { return list.indexOf(x) === i; });
}

// Calls onProgress({step, ...data}, fraction) if the caller gave one; the engine never touches a UI
// itself. Steps are codes (see i18n describeStep) so each app words them in its own language.
export function progress(onProgress, step, frac, data) {
  if (onProgress) onProgress(Object.assign({ step: step }, data), Math.max(0, Math.min(1, frac)));
}
