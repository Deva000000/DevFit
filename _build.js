const fs = require('fs');
const ver = 'devfit-v' + Date.now();
let sw = fs.readFileSync('sw.js', 'utf8');
sw = sw.replace(/const VERSION = 'devfit-v[\d.]+';/, `const VERSION = '${ver}';`);
fs.writeFileSync('sw.js', sw);
console.log('SW version bumped to', ver);
