#!/usr/bin/env node
// Contract fixture for Grove overlay lifecycle tests. It starts no workload.
import { appendFileSync } from 'node:fs';

const [verb, ...args] = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1] ?? null;
};
const apply = args.includes('--apply');
const planFirst = process.env.GROVE_OVERLAY_STUB_PLAN_FIRST !== 'false';
const positional = [];
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--apply' || arg === '--fail' || arg === '--malformed') continue;
  if (arg === '--image') {
    index += 1;
    continue;
  }
  if (!arg.startsWith('--')) positional.push(arg);
}

if (process.env.GROVE_OVERLAY_STUB_LOG) {
  appendFileSync(
    process.env.GROVE_OVERLAY_STUB_LOG,
    `${JSON.stringify({ verb, args, apply, cwd: process.cwd() })}\n`,
    'utf8'
  );
}

if (args.includes('--malformed')) {
  console.log('not-json');
  process.exit(0);
}

const result = {
  ok:
    !args.includes('--fail') &&
    (!process.env.GROVE_OVERLAY_STUB_FAIL_ENV ||
      process.env.GROVE_OVERLAY_STUB_FAIL_ENV !== positional[0]),
  verb,
  plan: verb === 'status' ? false : planFirst && !apply,
};
if (positional[0]) result.env = positional[0];
if (positional[1]) result.service = positional[1];
if (verb === 'attach') result.image = valueAfter('--image');
if (verb === 'status' && process.env.GROVE_OVERLAY_STUB_INVENTORY) {
  result.environments = JSON.parse(process.env.GROVE_OVERLAY_STUB_INVENTORY);
}

console.log(JSON.stringify(result));
