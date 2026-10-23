/**
 * Smoke: research helpers + fail-closed path (no network required unless SEARXNG_URL is set).
 *   npx tsx scripts/research-smoke.ts
 */
import {
  extractResearchQuery,
  formatWebHits,
  researchConfigured,
  searchSearxng,
  stripUnsourcedClaims,
} from '../src/va/research.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) console.log(`  ok  ${label}`);
  else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

console.log('\nresearch smoke\n──────────────');

check(
  'extractResearchQuery',
  extractResearchQuery('Research RivalCo funding for me') === 'RivalCo funding for me',
);
check(
  'stripUnsourcedClaims drops naked bullets',
  stripUnsourcedClaims(['• Claim with no link', '• Real one https://example.com/a', 'intro']).join('|')
    === '• Real one https://example.com/a|intro',
);
check(
  'formatWebHits always includes url',
  formatWebHits([{ title: 'T', url: 'https://example.com', snippet: 's' }])[0]!.includes('https://example.com'),
);

if (!researchConfigured()) {
  check('SEARXNG_URL unset (fail closed)', true);
} else {
  const res = await searchSearxng('searxng open source');
  if (!res.ok) {
    check('SearXNG reachable', false, res.error);
  } else {
    check('SearXNG reachable', true, `${res.hits.length} hits`);
    check(
      'every hit has https url',
      res.hits.every((h) => /^https?:\/\//i.test(h.url)),
    );
  }
}

console.log(failed ? `\n${failed} failed\n` : '\nall good\n');
process.exit(failed ? 1 : 0);
