// Driver for the csv-reader-speed entry: the harness runs `node /bot/main.ts`.
// It reads every case from /input/cases.json (an array of {id, input}),
// answers each one on its own with run() from ./solve.js, and writes the
// answers, in the cases' order, to /output/answers.json. Outside the
// sandbox, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input
// and /output.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// The house driver runs with V8's incremental marking off, set before
// solve.js is imported so the module's work runs under it too.
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
for (const entry of cases) answers.push(run(entry.input));

writeFileSync(join(outputDir, 'answers.json'), JSON.stringify(answers));
