[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/syahruldyh/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/syahruldyh/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

# csv-reader-speed-01

A fast, dependency-free drop-in replacement for csv-reader 1.0.0.

`solve.js` is an ES module whose `run(input)` returns, for each case's
`{text, header}` input, exactly the answer csv-reader 1.0.0 returns:
`{columns, rows, errors}` — including its reading of broken CSV (stray CRs,
quote junk, unterminated quotes) and its error objects in the order met.
`main.ts` is the harness driver: it reads every case from
`/input/cases.json`, answers each with `run`, and writes
`/output/answers.json`.

The parser is a single left-to-right pass, `indexOf`-driven, with a fast
path for plain single-line records.

[make.fun bounty](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
