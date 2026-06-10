type LcovRecord = {
  covered: number;
  relevant: number;
};

function parseLcov(text: string): LcovRecord {
  let covered = 0;
  let relevant = 0;

  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('DA:')) continue;
    const [, hitsText] = line.slice(3).split(',');
    const hits = Number(hitsText);
    relevant += 1;
    if (Number.isFinite(hits) && hits > 0) covered += 1;
  }

  return { covered, relevant };
}

const [, , reportPath, thresholdText] = Bun.argv;
if (!reportPath || !thresholdText) {
  console.error('usage: bun run scripts/check-global-coverage.ts LCOV_PATH THRESHOLD');
  process.exit(2);
}

const threshold = Number(thresholdText);
const record = parseLcov(await Bun.file(reportPath).text());
const coverage = record.relevant === 0 ? 100 : (record.covered / record.relevant) * 100;

if (coverage < threshold) {
  console.error(`Global coverage failed: ${coverage.toFixed(1)}% below ${threshold.toFixed(1)}%.`);
  process.exit(1);
}

console.log(`Global coverage gate passed at ${coverage.toFixed(1)}% >= ${threshold.toFixed(1)}%.`);
