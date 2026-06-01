type LcovRecord = {
  file: string;
  covered: number;
  relevant: number;
};

const criticalPaths = [
  'src/client/index.ts',
  'src/did/resolve.ts',
  'src/crypto/ed25519.ts',
  'src/crypto/signingInput.ts',
  'src/payments/index.ts',
  'src/mcp/runtime.ts',
  'src/mcp/tools/index.ts',
];

function normalize(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function parseLcov(text: string): LcovRecord[] {
  const records: LcovRecord[] = [];
  let current: LcovRecord | null = null;

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('SF:')) {
      current = { file: normalize(line.slice(3)), covered: 0, relevant: 0 };
      continue;
    }

    if (line.startsWith('DA:') && current) {
      const [, hitsText] = line.slice(3).split(',');
      const hits = Number(hitsText);
      current.relevant += 1;
      if (Number.isFinite(hits) && hits > 0) current.covered += 1;
      continue;
    }

    if (line === 'end_of_record' && current) {
      records.push(current);
      current = null;
    }
  }

  return records;
}

function percent(record: LcovRecord): number {
  return record.relevant === 0 ? 100 : (record.covered / record.relevant) * 100;
}

const [, , reportPath, thresholdText] = Bun.argv;
if (!reportPath || !thresholdText) {
  console.error('usage: bun run scripts/check-critical-coverage.ts LCOV_PATH THRESHOLD');
  process.exit(2);
}

const threshold = Number(thresholdText);
const records = parseLcov(await Bun.file(reportPath).text());
const failures: string[] = [];

for (const criticalPath of criticalPaths) {
  const normalized = normalize(criticalPath);
  const matches = records.filter(
    (record) => record.file === normalized || record.file.endsWith(`/${normalized}`),
  );

  if (matches.length === 0) {
    failures.push(`${normalized}: missing from coverage report`);
    continue;
  }

  for (const match of matches) {
    const coverage = percent(match);
    if (coverage < threshold) failures.push(`${match.file}: ${coverage.toFixed(1)}% below ${threshold}%`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`Critical coverage failed: ${failure}`);
  process.exit(1);
}

console.log(`Critical coverage gate passed at ${threshold.toFixed(1)}%.`);
