// Minimal test harness: test(name, fn); await done() exits nonzero on failure.
const tests = [];
export function test(name, fn) { tests.push([name, fn]); }
export async function done(label) {
  let fail = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log('  ok  ' + name); }
    catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n       ')); }
  }
  console.log(`${label}: ${tests.length - fail}/${tests.length} passed`);
  if (fail) process.exit(1);
}
