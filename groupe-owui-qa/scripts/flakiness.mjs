/**
 * Rapport de flakiness : lance la suite (+ la baseline) N fois de suite et
 * compte, pour chaque test, les succès / échecs et la durée moyenne.
 *
 *   npm run flakiness            # 10 exécutions
 *   npm run flakiness -- 3       # 3 exécutions
 *
 * Sorties : reports/flakiness.json (brut) et reports/flakiness.md (tableau).
 * Aucun retry n'est configuré : un échec est compté tel quel, rien n'est masqué.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runs = Number(process.argv[2] || 10);
const outDir = path.join(root, 'reports');
fs.mkdirSync(outDir, { recursive: true });

/** Parcourt le rapport JSON de Playwright et rend une ligne par test exécuté. */
function collect(suite, titles = [], out = []) {
  for (const s of suite.suites ?? []) collect(s, [...titles, s.title], out);
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests) {
      const r = t.results.at(-1);
      if (!r) continue;
      out.push({
        project: t.projectName,
        title: [...titles.slice(1), spec.title].filter(Boolean).join(' › '),
        status: r.status,
        duration: r.duration,
        error: r.error?.message?.split('\n')[0],
      });
    }
  }
  return out;
}

const stats = new Map();
const runSummaries = [];
for (let i = 1; i <= runs; i++) {
  const jsonFile = path.join(outDir, `.run-${i}.json`);
  const started = Date.now();
  spawnSync('npx playwright test --project=owui --project=baseline --reporter=json', {
    cwd: root, shell: true, stdio: 'ignore',
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: jsonFile },
  });
  const report = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  fs.rmSync(jsonFile);

  const results = collect(report).filter((r) => r.project !== 'setup');
  const failed = results.filter((r) => r.status !== 'passed' && r.status !== 'skipped');
  runSummaries.push({
    run: i,
    seconds: (Date.now() - started) / 1000,
    total: results.length,
    failed: failed.length,
    suiteFailed: failed.filter((r) => r.project === 'owui').length,
  });
  console.log(`run ${i}/${runs} : ${results.length - failed.length}/${results.length} OK en ${((Date.now() - started) / 1000).toFixed(1)} s`);

  for (const r of results) {
    const key = `${r.project}|${r.title}`;
    const s = stats.get(key) ?? { project: r.project, title: r.title, passed: 0, failed: 0, durations: [], errors: [] };
    if (r.status === 'passed') s.passed++; else s.failed++;
    if (r.error) s.errors.push(r.error);
    s.durations.push(r.duration);
    stats.set(key, s);
  }
}

const rows = [...stats.values()].map((s) => ({
  ...s,
  failRate: s.failed / (s.passed + s.failed),
  avgMs: Math.round(s.durations.reduce((a, b) => a + b, 0) / s.durations.length),
  errors: [...new Set(s.errors)],
}));
fs.writeFileSync(path.join(outDir, 'flakiness.json'), JSON.stringify({ date: new Date().toISOString(), runs, runSummaries, tests: rows }, null, 2));

const suite = rows.filter((r) => r.project === 'owui');
const verdict = (r) => (r.failed === 0 ? 'stable' : r.passed === 0 ? 'toujours en échec' : 'FLAKY');
const md = [
  `# Rapport de flakiness`,
  ``,
  `${runs} exécutions consécutives le ${new Date().toLocaleString('fr-FR')}, sans retry, environnement Docker local (2 tenants + LLM simulé).`,
  ``,
  `- Suite principale : **${suite.length} tests**, ${suite.filter((r) => r.failed === 0).length} stables, ` +
    `${suite.filter((r) => r.failed > 0).length} instables ou en échec.`,
  `- Exécutions entièrement vertes (suite principale) : **${runSummaries.filter((r) => r.suiteFailed === 0).length}/${runs}**`,
  `- Durée moyenne d'une exécution complète : ${(runSummaries.reduce((a, r) => a + r.seconds, 0) / runs).toFixed(1)} s`,
  ``,
  `| Projet | Test | Succès | Échecs | Taux d'échec | Durée moy. | Verdict |`,
  `|---|---|---:|---:|---:|---:|---|`,
  ...rows.map((r) => `| ${r.project} | ${r.title} | ${r.passed} | ${r.failed} | ${(r.failRate * 100).toFixed(0)} % | ${(r.avgMs / 1000).toFixed(1)} s | ${verdict(r)} |`),
  ``,
  `## Erreurs observées`,
  ``,
  ...rows.filter((r) => r.errors.length).flatMap((r) => [`- **${r.project} › ${r.title}** : ${r.errors.map((e) => '`' + e.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 160) + '`').join(' ; ')}`]),
  ``,
].join('\n');
fs.writeFileSync(path.join(outDir, 'flakiness.md'), md);
console.log(`\nRapport écrit dans reports/flakiness.md`);
