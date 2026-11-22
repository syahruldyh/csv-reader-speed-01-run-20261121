// main.ts — the driver the harness runs (`node /bot/main.ts`, Node 22).
//
// It reads every case from /input/cases.json (a JSON array of {id, input}),
// answers each case on its own with run() from ./solve.js, and writes the
// answers to /output/answers.json as a JSON array, one per case, in the
// cases' order. When run outside the sandbox, MAKEFUN_INPUT_DIR and
// MAKEFUN_OUTPUT_DIR stand in for /input and /output.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// Run with V8's incremental marking off, as the house driver does; the flag
// is set before solve.js is imported so all of its work runs under it.
setFlagsFromString('--no-incremental-marking');

const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => unknown;
};

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8')) as {
  id: string;
  input: unknown;
}[];

const answers: unknown[] = [];
for (const c of cases) answers.push(run(c.input));

writeFileSync(join(outputDir, 'answers.json'), JSON.stringify(answers));
