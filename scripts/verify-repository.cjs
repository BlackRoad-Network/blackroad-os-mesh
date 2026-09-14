const { readFileSync } = require('node:fs');
const statements = [
  'We access it all at RoadOS.',
  'We collaborate with Roadies.',
  'We code in Road.',
];
for (const path of ['README.md', 'BLACKROAD_CANON.md']) {
  const text = readFileSync(path, 'utf8');
  for (const statement of statements) {
    if (!text.includes(statement)) throw new Error(`${path} is missing canon: ${statement}`);
  }
}
console.log('README and local canon contain all three shared statements.');
