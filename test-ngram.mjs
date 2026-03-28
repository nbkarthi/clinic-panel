const ngrams = {
  'tab paracetamol': { '650mg SOS x 3 days': 100, '500mg TDS x 5 days': 40 },
  'c/o': { 'fever x 3 days': 60, 'cough x 5 days': 50 },
};

function ngramLookup(typedText) {
  const words = typedText.toLowerCase().trim().split(/\s+/);
  if (words.length === 0 || (words.length === 1 && words[0] === '')) {
    return { suggestion: null, confidence: 0 };
  }
  const unigram = words.slice(-1).join(' ');
  const bigram  = words.slice(-2).join(' ');
  const trigram = words.slice(-3).join(' ');
  let counts = ngrams[trigram] || ngrams[bigram] || ngrams[unigram] || null;

  if (!counts) {
    const typed = words.join(' ');
    let bestKey = null, bestLen = 0;
    for (const key of Object.keys(ngrams)) {
      if (key.startsWith(typed) && key.length > bestLen) {
        bestKey = key;
        bestLen = key.length;
      }
    }
    if (bestKey) {
      const keyRemainder = bestKey.slice(typed.length);
      const innerCounts = ngrams[bestKey];
      const total = Object.values(innerCounts).reduce((a, b) => a + b, 0);
      if (total === 0) return { suggestion: null, confidence: 0 };
      const [topVal, topCount] = Object.entries(innerCounts).sort((a, b) => b[1] - a[1])[0];
      const maturity = Math.min(total / 20, 1);
      const confidence = (topCount / total) * maturity;
      return { suggestion: keyRemainder + ' ' + topVal, confidence };
    }
    return { suggestion: null, confidence: 0 };
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return { suggestion: null, confidence: 0 };
  const [top, topCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const maturity = Math.min(total / 20, 1);
  const confidence = (topCount / total) * maturity;
  return { suggestion: top, confidence };
}

console.log('tab paracetamol:', JSON.stringify(ngramLookup('tab paracetamol')));
console.log('tab para:', JSON.stringify(ngramLookup('tab para')));
console.log('Tab Paracetamol:', JSON.stringify(ngramLookup('Tab Paracetamol')));
console.log('c/o:', JSON.stringify(ngramLookup('c/o')));
console.log('paracetamol:', JSON.stringify(ngramLookup('paracetamol')));
console.log('tab:', JSON.stringify(ngramLookup('tab')));
