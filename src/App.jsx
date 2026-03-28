import React, { useState, useEffect, useRef, useCallback } from 'react';
import Dexie from 'dexie';
import OpenAI from 'openai';

// ─── IndexedDB Schema ───────────────────────────────────────────
const db = new Dexie('ClinicPanelDB_v2');
db.version(1).stores({
  ngrams:    'key',
  notes:     '++id, createdAt',
  slotFills: '++id, prefix, hits, lastUsed',
});

db.version(2).stores({
  ngrams:    'key',
  notes:     '++id, createdAt',
  slotFills: '++id, prefix, hits, lastUsed',
}).upgrade((tx) => {
  // Clear corrupted ngrams that might have been saved before the parsing fix
  return tx.table('ngrams').clear();
});

// ─── DeepSeek via proxy ─────────────────────────────────────────
const client = new OpenAI({
  apiKey: 'not-needed',
  baseURL: window.location.origin + '/api',
  dangerouslyAllowBrowser: true,
});

const NOTES_PROMPT = `You are a clinical assistant for Indian doctors writing SOAP notes. Complete the doctor's partial note naturally. Use Indian medical abbreviations: c/o, h/o, k/c/o, O/E, P/R/S. Output only the completion text, nothing else. Maximum 2 sentences.`;

const SLOTS_PROMPT = `You are a clinical assistant for Indian doctors. Given a drug name and patient context, return ONLY a JSON object with these fields: dose, route, frequency, duration, instructions. Use Indian conventions: Tab./Cap./Syr., BD/TDS/OD/SOS/QID, before/after food. Example: {"dose":"650mg","route":"Oral","frequency":"SOS","duration":"3 days","instructions":"After food"}`;

async function callDeepSeek(systemPrompt, userText, onChunk) {
  const stream = await client.chat.completions.create({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userText },
    ],
    max_tokens: 80,
    temperature: 0.1,
    stream: true,
  });
  let full = '';
  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content || '';
    if (token) {
      full += token;
      onChunk(full);
    }
  }
  return full;
}

// ─── Seed N-grams ───────────────────────────────────────────────
const SEED_NGRAMS = {
  "tab paracetamol":    { "650mg SOS x 3 days": 100, "500mg TDS x 5 days": 40 },
  "tab ibuprofen":      { "400mg TDS after food": 80, "200mg BD": 30 },
  "tab diclofenac":     { "50mg BD after food": 70 },
  "tab aceclofenac":    { "100mg BD after food": 65 },
  "tab nimesulide":     { "100mg BD after food": 50 },
  "tab tramadol":       { "50mg BD": 40, "100mg SOS": 20 },

  "tab azithromycin":   { "500mg OD x 5 days": 100, "250mg OD x 3 days": 30 },
  "tab amoxicillin":    { "500mg TDS x 5 days": 90, "250mg TDS x 5 days": 40 },
  "tab augmentin":      { "625mg BD x 5 days": 85 },
  "tab ciprofloxacin":  { "500mg BD x 5 days": 80 },
  "tab ofloxacin":      { "200mg BD x 5 days": 70 },
  "tab doxycycline":    { "100mg BD x 7 days after food": 60 },
  "tab cefixime":       { "200mg BD x 5 days": 75 },
  "tab cephalexin":     { "500mg TDS x 5 days": 55 },
  "tab levofloxacin":   { "500mg OD x 5 days": 65 },
  "tab metronidazole":  { "400mg TDS x 5 days": 70 },
  "tab norfloxacin":    { "400mg BD x 5 days": 55 },
  "tab cotrimoxazole":  { "DS BD x 5 days": 40 },
  "tab nitrofurantoin": { "100mg BD x 5 days": 50 },
  "tab linezolid":      { "600mg BD x 7 days": 30 },
  "tab clindamycin":    { "300mg TDS x 5 days": 35 },
  "tab fluconazole":    { "150mg single dose": 60, "150mg OD x 7 days": 30 },

  "tab metformin":      { "500mg BD with meals": 100, "850mg BD": 30, "500mg OD": 20 },
  "tab glimepiride":    { "1mg OD before breakfast": 80, "2mg OD": 40 },
  "tab sitagliptin":    { "100mg OD": 60 },
  "tab vildagliptin":   { "50mg BD": 50 },
  "tab gliclazide":     { "80mg BD before food": 55 },
  "tab pioglitazone":   { "15mg OD": 40 },
  "tab empagliflozin":  { "10mg OD": 45, "25mg OD": 25 },
  "tab dapagliflozin":  { "10mg OD": 40 },
  "tab teneligliptin":  { "20mg OD": 45 },
  "inj insulin glargine": { "10 units SC at bedtime": 40 },

  "tab amlodipine":     { "5mg OD": 100, "10mg OD": 40 },
  "tab telmisartan":    { "40mg OD": 80, "80mg OD": 40 },
  "tab losartan":       { "50mg OD": 70, "100mg OD": 30 },
  "tab atenolol":       { "50mg OD": 70, "25mg OD": 40 },
  "tab metoprolol":     { "25mg BD": 60, "50mg BD": 40 },
  "tab ramipril":       { "5mg OD": 55, "2.5mg OD": 35 },
  "tab enalapril":      { "5mg BD": 45 },
  "tab clinidipine":    { "5mg BD": 50, "10mg BD": 30 },
  "tab prazosin":       { "2.5mg BD": 30 },
  "tab hydrochlorothiazide": { "12.5mg OD": 50 },
  "tab furosemide":     { "40mg OD": 60, "20mg OD": 30 },
  "tab spironolactone": { "25mg OD": 45, "50mg OD": 25 },
  "tab chlorthalidone": { "12.5mg OD": 40 },

  "tab pantoprazole":   { "40mg OD before food": 100, "40mg BD": 30 },
  "tab omeprazole":     { "20mg OD before food": 90 },
  "tab rabeprazole":    { "20mg OD before food": 75 },
  "tab domperidone":    { "10mg TDS before food": 80 },
  "tab ondansetron":    { "4mg TDS": 70, "8mg BD": 40 },
  "tab sucralfate":     { "1g BD before food": 40 },
  "tab dicyclomine":    { "20mg TDS": 45 },
  "tab drotaverine":    { "80mg TDS": 50 },
  "tab mebeverine":     { "135mg TDS before food": 35 },
  "syr lactulose":      { "15ml OD at night": 50 },
  "tab bisacodyl":      { "5mg OD at night": 35 },
  "tab loperamide":     { "2mg SOS after loose stool": 40 },
  "ors":                { "1 sachet in 1L water, sip frequently": 70 },
  "tab ranitidine":     { "150mg BD before food": 45 },
  "tab famotidine":     { "20mg BD": 35 },

  "tab cetirizine":     { "10mg OD at night": 100 },
  "tab fexofenadine":   { "120mg OD": 70, "180mg OD": 50 },
  "tab levocetirizine": { "5mg OD at night": 80 },
  "tab montelukast":    { "10mg OD at night": 80 },
  "tab chlorpheniramine": { "4mg TDS": 40 },
  "tab desloratadine":  { "5mg OD": 35 },
  "tab prednisolone":   { "10mg OD x 5 days": 50, "40mg OD taper": 30 },
  "tab deflazacort":    { "6mg OD x 5 days": 40 },
  "tab methylprednisolone": { "8mg OD x 5 days": 35 },
  "inh salbutamol":     { "2 puffs SOS": 70 },
  "inh budesonide":     { "200mcg BD": 55 },
  "inh formoterol+budesonide": { "1 puff BD": 50 },
  "tab theophylline":   { "300mg BD": 30 },
  "tab ambroxol":       { "30mg TDS": 45 },
  "syr ambroxol":       { "5ml TDS": 40 },
  "tab dextromethorphan": { "10mg TDS": 30 },

  "tab atorvastatin":   { "10mg OD at night": 100, "20mg OD": 60, "40mg OD": 30 },
  "tab rosuvastatin":   { "10mg OD": 80, "20mg OD": 40 },

  "tab levothyroxine":  { "50mcg OD empty stomach": 80, "100mcg OD": 50, "25mcg OD": 30 },
  "tab carbimazole":    { "10mg TDS": 30 },

  "tab vitamin d3":     { "60000 IU once weekly x 8 weeks": 80 },
  "tab calcium":        { "500mg BD after food": 70 },
  "tab vitamin b12":    { "1500mcg OD": 60 },
  "tab folic acid":     { "5mg OD": 70 },
  "tab iron":           { "100mg OD before food": 60 },
  "tab multivitamin":   { "1 OD": 50 },
  "tab zinc":           { "50mg OD x 14 days": 45 },
  "tab vitamin c":      { "500mg OD": 40 },
  "tab becosules":      { "1 OD": 45 },
  "tab shelcal":        { "500mg OD": 40 },

  "tab alprazolam":     { "0.25mg SOS at night": 40, "0.5mg OD at night": 30 },
  "tab clonazepam":     { "0.5mg OD at night": 35 },
  "tab escitalopram":   { "10mg OD": 45, "5mg OD": 30 },
  "tab sertraline":     { "50mg OD": 40 },
  "tab amitriptyline":  { "10mg OD at night": 35, "25mg OD at night": 25 },
  "tab gabapentin":     { "300mg TDS": 35 },
  "tab pregabalin":     { "75mg BD": 40 },

  "tab aspirin":        { "75mg OD after food": 60, "150mg OD": 30 },
  "tab clopidogrel":    { "75mg OD": 55 },
  "tab warfarin":       { "5mg OD": 30 },
  "tab rivaroxaban":    { "10mg OD": 25 },

  "tab tamsulosin":     { "0.4mg OD at night": 50 },
  "tab finasteride":    { "5mg OD": 30 },
  "tab sildenafil":     { "50mg SOS": 30 },

  "tab acyclovir":      { "800mg 5 times/day x 7 days": 35 },
  "tab albendazole":    { "400mg single dose": 60 },
  "tab ivermectin":     { "12mg single dose": 35 },
  "tab hydroxychloroquine": { "200mg BD": 25 },

  "eye drop timolol":   { "0.5% 1 drop BD both eyes": 30 },
  "eye drop ciprofloxacin": { "1 drop QID x 5 days": 40 },
  "eye drop lubricant": { "1 drop QID": 35 },

  "cream betamethasone": { "apply thin layer BD x 7 days": 40 },
  "cream clotrimazole": { "apply BD x 14 days": 45 },
  "cream mupirocin":    { "apply TDS x 5 days": 35 },
  "cream fusidic acid": { "apply BD x 7 days": 30 },
  "lotion calamine":    { "apply SOS for itch": 40 },
  "oint framycetin":    { "apply BD x 5 days": 25 },

  "tab phenytoin":      { "100mg TDS": 25 },
  "tab valproate":      { "500mg BD": 30 },
  "tab carbamazepine":  { "200mg BD": 25 },
  "tab levetiracetam":  { "500mg BD": 30 },

  "tab isosorbide dinitrate": { "10mg TDS": 25 },
  "tab digoxin":        { "0.25mg OD": 20 },
  "tab diltiazem":      { "30mg TDS": 20 },

  "inj tetanus toxoid": { "0.5ml IM single dose": 50 },
  "inj diclofenac":     { "75mg IM SOS": 45 },
  "inj ondansetron":    { "4mg IV SOS": 35 },
  "inj ranitidine":     { "50mg IV BD": 30 },
  "inj pantoprazole":   { "40mg IV OD": 35 },

  // Common diagnosis n-grams
  "type 2 diabetes":    { "mellitus, uncontrolled": 80, "mellitus, controlled": 40 },
  "essential":          { "hypertension, grade 1": 70, "hypertension, grade 2": 40 },
  "acute":              { "upper respiratory tract infection": 80, "gastroenteritis": 50, "pharyngitis": 40 },
  "vitamin d":          { "deficiency": 90 },
  "hypothyroidism":     { ", on treatment": 70, ", newly diagnosed": 40 },
  "iron deficiency":    { "anaemia": 80 },
  "urinary tract":      { "infection": 90 },
  "viral":              { "fever": 80, "upper respiratory infection": 50 },
  "allergic":           { "rhinitis": 70, "dermatitis": 40 },
  "fungal":             { "infection of skin": 50 },
  "low back":           { "pain, mechanical": 60, "pain with radiculopathy": 30 },
  "acid peptic":        { "disease": 70 },
  "tension":            { "headache": 60, "type headache": 40 },
  "osteoarthritis":     { "of knee, bilateral": 50, "of knee, right": 30 },
  "cervical":           { "spondylosis": 50 },
  "dengue":             { "fever, NS1 positive": 40, "fever, suspected": 30 },
  "typhoid":            { "fever, Widal positive": 40 },
  "diabetes mellitus":  { "type 2, on OHA": 60, "type 2, on insulin": 30 },
  "chronic kidney":     { "disease, stage 3": 30 },
  "coronary artery":    { "disease, stable": 30 },

  // SOAP note n-grams
  "c/o":                { "fever x 3 days": 60, "cough x 5 days": 50, "pain abdomen x 2 days": 40 },
  "h/o":                { "diabetes mellitus": 50, "hypertension": 40, "similar complaints in past": 30 },
  "k/c/o":              { "type 2 DM on OHA": 50, "HTN on medication": 40 },
  "o/e":                { "patient conscious, oriented": 60, "vitals stable": 50 },
  "bp:":                { "130/80 mmHg": 40, "140/90 mmHg": 30, "120/80 mmHg": 50 },
  "temp:":              { "100.4°F": 40, "99°F": 30, "101°F": 25 },
  "pulse:":             { "80/min regular": 50, "76/min": 30, "90/min": 25 },
  "rbs:":               { "140 mg/dL": 30, "200 mg/dL": 25, "180 mg/dL": 20 },
  "throat:":            { "congested": 50, "normal": 30 },
  "chest:":             { "bilateral clear": 50, "rhonchi present": 25 },
  "abdomen:":           { "soft, non-tender": 60, "mild tenderness in epigastrium": 25 },
  "cvs:":               { "S1S2 normal, no murmur": 50 },
  "cns:":               { "NAD": 50, "within normal limits": 30 },
  "p/a:":               { "soft, non-tender, no organomegaly": 40 },
  "rs:":                { "NVBS bilateral, no added sounds": 45 },
  "adv:":               { "blood sugar fasting & PP": 30, "CBC, ESR": 25, "lipid profile": 20 },
  "diagnosis:":         { "acute URTI": 40, "viral fever": 35, "AGE": 25 },
  "follow up":          { "after 1 week": 60, "after 3 days": 40, "SOS": 30 },
};

// ─── N-gram System ──────────────────────────────────────────────
let ngrams = {};

function ngramLookup(typedText) {
  const words = typedText.toLowerCase().trim().split(/\s+/);
  if (words.length === 0 || (words.length === 1 && words[0] === '')) {
    return [];
  }

  let results = [];
  const typed = words.join(' ');

  // Try exact match first: trigram, bigram, unigram
  const unigram = words.slice(-1).join(' ');
  const bigram  = words.slice(-2).join(' ');
  const trigram = words.slice(-3).join(' ');
  let counts = ngrams[trigram] || ngrams[bigram] || ngrams[unigram] || null;

  if (counts) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total > 0) {
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      for (const [topVal, topCount] of sorted.slice(0, 5)) {
        const maturity = Math.min(total / 20, 1);
        const confidence = (topCount / total) * maturity;
        results.push({ suggestion: topVal, resolvedKey: typedText.toLowerCase().trim(), resolvedValue: topVal, confidence });
      }
    }
  }

  // If no exact matches find up to 10 prefix matches
  if (results.length === 0) {
    let matches = [];
    for (const key of Object.keys(ngrams)) {
      if (key.startsWith(typed)) matches.push(key);
    }
    matches.sort((a, b) => a.length - b.length).slice(0, 10).forEach(key => {
      const keyRemainder = key.slice(typed.length);
      const innerCounts = ngrams[key];
      const total = Object.values(innerCounts).reduce((a, b) => a + b, 0);
      const [topVal, topCount] = Object.entries(innerCounts).sort((a, b) => b[1] - a[1])[0];
      const maturity = Math.min(total / 20, 1);
      const confidence = (topCount / total) * maturity;
      results.push({ suggestion: keyRemainder + ' ' + topVal, resolvedKey: key, resolvedValue: topVal, confidence });
    });
  }

  return results;
}

async function learn(typedText, accepted) {
  const words = typedText.toLowerCase().trim().split(/\s+/);
  const keys  = [words.slice(-2).join(' '), words.slice(-3).join(' ')];
  for (const key of keys) {
    if (!key || key.trim() === '') continue;
    if (!ngrams[key]) ngrams[key] = {};
    ngrams[key][accepted] = (ngrams[key][accepted] || 0) + 1;
    await db.ngrams.put({ key, counts: ngrams[key] });
  }
}

async function unlearn(key, value) {
  key = key.toLowerCase().trim();
  if (!ngrams[key]) return;
  delete ngrams[key][value];
  if (Object.keys(ngrams[key]).length === 0) {
    delete ngrams[key];
    await db.ngrams.delete(key);
  } else {
    await db.ngrams.put({ key, counts: ngrams[key] });
  }
  console.log('[Rx] unlearned:', key, '→', value);
}

async function weeklyDecay() {
  const all = await db.ngrams.toArray();
  for (const entry of all) {
    for (const word in entry.counts) {
      entry.counts[word] *= 0.97;
      if (entry.counts[word] < 1) delete entry.counts[word];
    }
    await db.ngrams.put(entry);
  }
  localStorage.setItem('lastDecay', Date.now().toString());
}

// ─── Note Search (simple text match, no embedding needed) ───────
async function findSimilarNote(currentText) {
  const query = currentText.toLowerCase().trim();
  if (query.length < 10) return null;
  const allNotes = await db.notes.toArray();
  let best = null, bestScore = 0;
  for (const note of allNotes) {
    if (!note.text) continue;
    // Simple word overlap score
    const noteWords = new Set(note.text.toLowerCase().split(/\s+/));
    const queryWords = query.split(/\s+/);
    const matches = queryWords.filter(w => noteWords.has(w)).length;
    const score = matches / queryWords.length;
    if (score > bestScore) { bestScore = score; best = note; }
  }
  return bestScore > 0.5 ? best : null;
}

// ─── Badge Component ────────────────────────────────────────────
function SourceBadge({ type }) {
  const config = {
    local:   { label: '⚡ Local',  cls: 'badge-local' },
    ai:      { label: '✦ AI',     cls: 'badge-ai' },
    cached:  { label: '~ Cached', cls: 'badge-cached' },
  };
  const c = config[type] || config.cached;
  return <span className={`source-badge ${c.cls}`}>{c.label}</span>;
}

// ─── Confidence Bar ─────────────────────────────────────────────
function ConfidenceBar({ value }) {
  const pct = Math.round(value * 100);
  const color = value > 0.6 ? '#48BB78' : value > 0.3 ? '#ECC94B' : '#FC8181';
  return (
    <div className="confidence-bar">
      <div className="confidence-fill" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

// ─── Ghost Input ────────────────────────────────────────────────
function GhostInput({ value, onChange, ghost, onAccept, onDismiss, placeholder, multiline, badge }) {
  const inputRef = useRef(null);

  const handleKeyDown = (e) => {
    if (e.key === 'Tab' && ghost) {
      e.preventDefault();
      onAccept();
    } else if (e.key === 'Escape' && ghost) {
      e.preventDefault();
      onDismiss();
    }
  };

  if (multiline) {
    return (
      <div className="ghost-container ghost-container-multiline">
        <div className="ghost-wrapper">
          <textarea
            ref={inputRef}
            className="ghost-input ghost-textarea"
            value={value}
            onChange={onChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={4}
          />
          {ghost && (
            <div className="ghost-hint ghost-hint-multiline">
              <span className="ghost-text">{ghost}</span>
              <span className="ghost-key">Tab</span>
            </div>
          )}
        </div>
        {badge && <SourceBadge type={badge} />}
      </div>
    );
  }

  return (
    <div className="ghost-container">
      <input
        ref={inputRef}
        className="ghost-input"
        value={value}
        onChange={onChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
      />
      {ghost && (
        <div className="ghost-hint">
          <span className="ghost-text">{ghost}</span>
          <span className="ghost-key">Tab</span>
        </div>
      )}
      {badge && <SourceBadge type={badge} />}
    </div>
  );
}

// ─── Parse n-gram suggestion into slot fields ──────────────────
// e.g. "650mg SOS x 3 days" → { dose: "650mg", frequency: "SOS", duration: "3 days" }
// e.g. "500mg TDS x 5 days" → { dose: "500mg", frequency: "TDS", duration: "5 days" }
// e.g. "40mg OD before food" → { dose: "40mg", frequency: "OD", instructions: "before food" }
function parseNgramToSlots(suggestion) {
  const slots = { dose: '', route: 'Oral', frequency: '', duration: '', instructions: '' };
  const text = suggestion.trim();

  // Extract dose (number + unit at start)
  const doseMatch = text.match(/^(\d+[\w/]*\s*(?:mg|mcg|g|ml|IU|units?|puffs?|drop|sachet)s?)\b/i);
  if (doseMatch) {
    slots.dose = doseMatch[1].trim();
  }

  // Extract frequency
  const freqMatch = text.match(/\b(OD|BD|TDS|QID|SOS|once weekly|once daily|5 times\/day|at night|before breakfast)\b/i);
  if (freqMatch) {
    slots.frequency = freqMatch[1];
  }

  // Extract duration (x N days/weeks or single dose)
  const durMatch = text.match(/x\s*(\d+\s*(?:days?|weeks?|months?))/i);
  if (durMatch) {
    slots.duration = durMatch[1].trim();
  } else if (/single dose/i.test(text)) {
    slots.duration = 'single dose';
  } else if (/once weekly/i.test(text)) {
    const weekMatch = text.match(/x\s*(\d+\s*weeks?)/i);
    if (weekMatch) slots.duration = weekMatch[1];
  }

  // Extract instructions (after food, before food, empty stomach, etc.)
  const instrMatch = text.match(/\b((?:before|after|with|empty)\s+(?:food|meals?|stomach).*?)$/i);
  if (instrMatch) {
    slots.instructions = instrMatch[1].trim();
  }
  if (/at night/i.test(text) && !slots.instructions) {
    slots.instructions = 'at night';
  }

  // Route hints
  if (/\bIM\b/.test(text)) slots.route = 'IM';
  if (/\bIV\b/.test(text)) slots.route = 'IV';
  if (/\bSC\b/.test(text)) slots.route = 'SC';
  if (/\binh\b/i.test(text) || /\bpuffs?\b/i.test(text)) slots.route = 'Inhalation';
  if (/\bdrop\b/i.test(text)) slots.route = 'Topical';
  if (/\bapply\b/i.test(text)) slots.route = 'Topical';

  return slots;
}

// ─── Prescription Row ───────────────────────────────────────────
function PrescriptionRow({ row, index, onUpdate, onRemove, isOnline }) {
  const [suggestions, setSuggestions] = useState([]);
  const [confidence, setConfidence] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const debounceRef = useRef(null);
  const learnedRef = useRef(''); // track what we already learned to avoid duplicates
  const rowRef = useRef(row); // always holds latest row to avoid stale closures
  rowRef.current = row;

  // Learn from manual entries when the row loses focus
  const learnFromRow = useCallback(() => {
    const r = rowRef.current;
    const drug = r.drug.trim().toLowerCase();
    const dose = r.dose.trim();
    const freq = r.frequency.trim();
    if (!drug || !dose) return; // need at least drug + dose

    // Build the value string the same way seed ngrams are structured
    let value = dose;
    if (freq) value += ' ' + freq;
    if (r.duration.trim()) value += ' x ' + r.duration.trim();
    if (r.instructions.trim()) value += ' ' + r.instructions.trim();

    // Skip if we already learned this exact combo
    const key = drug + '::' + value;
    if (learnedRef.current === key) return;
    learnedRef.current = key;

    console.log('[Rx] learning manual entry:', drug, '→', value);
    learn(drug, value);
  }, []);

  const handleDrugChange = (e) => {
    const val = e.target.value;
    onUpdate(index, { ...row, drug: val });

    clearTimeout(debounceRef.current);
    if (!val.trim()) {
      setSuggestions([]);
      setConfidence(0);
      setSelectedIndex(0);
      return;
    }

    debounceRef.current = setTimeout(() => {
      const results = ngramLookup(val);
      if (results && results.length > 0) {
        console.log('[Rx] lookup:', JSON.stringify(val), 'found', results.length, 'matches');
        setConfidence(results[0].confidence);
        setSuggestions(results);
        setSelectedIndex(0);
      } else {
        setSuggestions([]);
        setSelectedIndex(0);
        // API fallback
        if (isOnline) {
          callDeepSeek(SLOTS_PROMPT, val, (full) => {
            try {
              const parsed = JSON.parse(full);
              const label = `${parsed.dose} ${parsed.frequency} x ${parsed.duration}`;
              setSuggestions([{
                suggestion: label,
                resolvedKey: val,
                resolvedValue: label,
                confidence: 0.5
              }]);
              setSelectedIndex(0);
              setConfidence(0.5);
            } catch { /* wait for complete JSON */ }
          }).catch((err) => console.error('[Rx] API error:', err));
        }
      }
    }, 200);
  };

  const acceptSuggestion = (s) => {
    console.log('[Rx] accepted:', s.suggestion);
    const slots = parseNgramToSlots(s.resolvedValue);
    console.log('[Rx] updating drug with:', s.resolvedKey);
    onUpdate(index, {
      ...row,
      drug: s.resolvedKey || row.drug,
      dose: slots.dose || row.dose,
      route: slots.route || row.route,
      frequency: slots.frequency || row.frequency,
      duration: slots.duration || row.duration,
      instructions: slots.instructions || row.instructions,
    });
    learn(s.resolvedKey, s.resolvedValue);
    setSuggestions([]);
  };

  const removeSuggestion = (s, e) => {
    e.stopPropagation();
    e.preventDefault();
    unlearn(s.resolvedKey, s.resolvedValue);
    setSuggestions(prev => prev.filter(item => item !== s));
  };

  return (
    <div className="rx-row" onBlur={(e) => {
      // Only learn when focus leaves the entire row (not moving between fields within it)
      if (!e.currentTarget.contains(e.relatedTarget)) {
        learnFromRow();
      }
    }}>
      <span className="rx-num">{index + 1}.</span>
      <div className="rx-drug-col">
        <input
          className="ghost-input"
          value={row.drug}
          onChange={handleDrugChange}
          onKeyDown={(e) => {
            if ((e.key === 'Tab' || e.key === 'Enter') && suggestions.length > 0) {
              e.preventDefault();
              acceptSuggestion(suggestions[selectedIndex]);
            } else if (e.key === 'ArrowDown' && suggestions.length > 0) {
              e.preventDefault();
              setSelectedIndex(prev => (prev + 1) % suggestions.length);
            } else if (e.key === 'ArrowUp' && suggestions.length > 0) {
              e.preventDefault();
              setSelectedIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
            } else if (e.key === 'Escape') {
              setSuggestions([]);
              setSelectedIndex(0);
            }
          }}
          placeholder="Drug name..."
        />
        {suggestions.length > 0 && (
          <div className="suggestion-dropdown">
            {suggestions.map((s, i) => (
              <div key={i} className={`suggestion-item ${i === selectedIndex ? 'selected' : ''}`} onPointerDown={(e) => {
                e.preventDefault();
                acceptSuggestion(s);
              }}>
                <span><b>{s.resolvedKey}</b> • {s.resolvedValue}</span>
                <div className="suggestion-actions">
                  <span className="ghost-key">Tab</span>
                  <button className="suggestion-remove" onPointerDown={(e) => removeSuggestion(s, e)} title="Remove this suggestion">×</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <ConfidenceBar value={confidence} />
      </div>
      <input className="rx-field" value={row.dose} onChange={(e) => onUpdate(index, { ...row, dose: e.target.value })} placeholder="Dose" />
      <input className="rx-field rx-field-sm" value={row.route} onChange={(e) => onUpdate(index, { ...row, route: e.target.value })} placeholder="Route" />
      <input className="rx-field" value={row.frequency} onChange={(e) => onUpdate(index, { ...row, frequency: e.target.value })} placeholder="Freq" />
      <input className="rx-field" value={row.duration} onChange={(e) => onUpdate(index, { ...row, duration: e.target.value })} placeholder="Duration" />
      <input className="rx-field" value={row.instructions} onChange={(e) => onUpdate(index, { ...row, instructions: e.target.value })} placeholder="Instructions" />
      <button className="rx-remove" onClick={() => onRemove(index)} title="Remove">×</button>
    </div>
  );
}

// ─── Quick Add Buttons ──────────────────────────────────────────
const QUICK_INSTRUCTIONS = [
  'Rest for 3 days',
  'Drink plenty of fluids',
  'Avoid cold food & drinks',
  'Follow up after 1 week',
  'Follow up after 3 days',
  'Take medicines regularly',
  'Monitor blood sugar daily',
  'Avoid oily/spicy food',
  'Light diet',
  'Steam inhalation BD',
];

// ─── Main App ───────────────────────────────────────────────────
const emptyRow = () => ({ drug: '', dose: '', route: '', frequency: '', duration: '', instructions: '' });

export default function App() {
  const [patientName, setPatientName] = useState('');
  const [patientAge, setPatientAge]   = useState('');
  const [patientSex, setPatientSex]   = useState('M');
  const [notes, setNotes]             = useState('');
  const [notesGhost, setNotesGhost]   = useState('');
  const [notesBadge, setNotesBadge]   = useState(null);
  const [rows, setRows]               = useState([emptyRow()]);
  const [instructions, setInstructions] = useState('');
  const [isOnline, setIsOnline]       = useState(false);
  const [dbReady, setDbReady]         = useState(false);

  const notesDebounceRef = useRef(null);

  // ── Init ──────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      // 1. Init DB
      await db.open();

      // 2. Seed n-grams if empty
      const count = await db.ngrams.count();
      if (count === 0) {
        const entries = Object.entries(SEED_NGRAMS).map(([key, counts]) => ({ key, counts }));
        await db.ngrams.bulkPut(entries);
      }

      // 3. Load n-grams into memory
      const allNgrams = await db.ngrams.toArray();
      for (const entry of allNgrams) {
        ngrams[entry.key] = entry.counts;
      }
      console.log('[Init] Loaded', allNgrams.length, 'n-grams into memory');

      // 4. Weekly decay
      const lastDecay = parseInt(localStorage.getItem('lastDecay') || '0');
      if (Date.now() - lastDecay > 7 * 24 * 60 * 60 * 1000) {
        await weeklyDecay();
      }

      setDbReady(true);

      console.log('[Init] Ready — n-gram + DeepSeek autocomplete active');

      // 6. Health check
      checkHealth();
    })();
  }, []);

  // ── Health check ──────────────────────────────────────────────
  const checkHealth = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const resp = await fetch('/health', { signal: controller.signal });
      clearTimeout(timeout);
      setIsOnline(resp.ok);
    } catch {
      setIsOnline(false);
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  // ── Notes autocomplete ────────────────────────────────────────
  const handleNotesChange = (e) => {
    const val = e.target.value;
    setNotes(val);
    setNotesGhost('');
    setNotesBadge(null);

    clearTimeout(notesDebounceRef.current);
    if (!val.trim() || val.length < 5) return;

    notesDebounceRef.current = setTimeout(async () => {
      // Try n-gram first
      const results = ngramLookup(val);
      const suggestion = results.length > 0 ? results[0].suggestion : '';
      const confidence = results.length > 0 ? results[0].confidence : 0;
      console.log('[Notes] lookup:', JSON.stringify(val.slice(-30)), '→', suggestion, 'conf:', confidence.toFixed(2));
      if (confidence > 0.6 && suggestion) {
        setNotesGhost(suggestion);
        setNotesBadge('local');
        return;
      }

      // Try past notes (text similarity)
      const similar = await findSimilarNote(val);
      if (similar) {
        const noteText = similar.text;
        if (noteText.length > val.length) {
          setNotesGhost(noteText.slice(val.length, val.length + 120));
          setNotesBadge('cached');
          return;
        }
      }

      // Fallback to API
      console.log('[Notes] API fallback check: isOnline=', isOnline, 'conf=', confidence.toFixed(2));
      if (isOnline && confidence <= 0.6) {
        console.log('[Notes] Calling DeepSeek for:', val.slice(-40));
        if (confidence > 0.3 && suggestion) {
          setNotesGhost(suggestion);
          setNotesBadge('local');
        }
        callDeepSeek(NOTES_PROMPT, val, (full) => {
          console.log('[Notes] DeepSeek chunk:', full.slice(0, 50));
          setNotesGhost(full);
          setNotesBadge('ai');
        }).catch((err) => { console.error('[Notes] DeepSeek error:', err); });
      }
    }, 400);
  };

  const acceptNotesGhost = async () => {
    if (notesGhost) {
      const newNotes = notes + notesGhost;
      setNotes(newNotes);
      learn(notes, notesGhost);
      setNotesGhost('');
      setNotesBadge(null);

      // Save note for future text-match suggestions
      await db.notes.add({ text: newNotes, createdAt: Date.now() });
    }
  };

  // ── Prescription rows ─────────────────────────────────────────
  const updateRow = (index, newRow) => {
    setRows(prev => prev.map((r, i) => i === index ? newRow : r));
  };

  const removeRow = (index) => {
    setRows(prev => prev.length === 1 ? [emptyRow()] : prev.filter((_, i) => i !== index));
  };

  const addRow = () => {
    setRows(prev => [...prev, emptyRow()]);
  };

  // ── Learn manually typed notes on blur ──────────────────────────
  const notesSavedRef = useRef('');
  const learnNotes = useCallback(async () => {
    const text = notes.trim();
    if (text.length < 10) return; // too short to be useful
    if (notesSavedRef.current === text) return; // already saved this exact text
    notesSavedRef.current = text;

    // Save full note for text-similarity matching
    await db.notes.add({ text, createdAt: Date.now() });

    // Learn ngrams from the note (each line as a phrase)
    const lines = text.split('\n').filter(l => l.trim().length > 3);
    for (const line of lines) {
      const words = line.trim().toLowerCase().split(/\s+/);
      if (words.length >= 2) {
        const key = words.slice(0, 2).join(' ');
        const value = words.slice(2).join(' ');
        if (value) learn(key, value);
      }
    }
    console.log('[Notes] learned manual notes:', lines.length, 'lines');
  }, [notes]);

  // ── Quick instruction add ─────────────────────────────────────
  const addQuickInstruction = (text) => {
    setInstructions(prev => {
      if (prev.trim()) return prev + '\n• ' + text;
      return '• ' + text;
    });
  };

  // ── New patient ───────────────────────────────────────────────
  const newPatient = () => {
    learnNotes(); // save current notes before clearing
    setPatientName('');
    setPatientAge('');
    setPatientSex('M');
    setNotes('');
    setNotesGhost('');
    setNotesBadge(null);
    setRows([emptyRow()]);
    setInstructions('');
    notesSavedRef.current = '';
  };

  // ── Keyboard shortcut ─────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e) => {
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        addRow();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // ── Today's date ──────────────────────────────────────────────
  const today = new Date().toLocaleDateString('en-IN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <h1 className="logo">ClinicScript</h1>
          <span className={`online-badge ${isOnline ? 'online' : 'offline'}`}>
            {isOnline ? '● Online' : '○ Offline'}
          </span>
        </div>
        <div className="header-right">
          <button className="btn btn-secondary" onClick={() => window.print()}>Print</button>
          <button className="btn btn-primary" onClick={newPatient}>New Patient</button>
        </div>
      </header>

      {/* Patient Info */}
      <div className="patient-bar">
        <label className="patient-field">
          <span>Name</span>
          <input value={patientName} onChange={(e) => setPatientName(e.target.value)} placeholder="Enter name" />
        </label>
        <label className="patient-field patient-field-sm">
          <span>Age</span>
          <input value={patientAge} onChange={(e) => setPatientAge(e.target.value)} placeholder="Age" />
        </label>
        <label className="patient-field patient-field-sm">
          <span>Sex</span>
          <select value={patientSex} onChange={(e) => setPatientSex(e.target.value)}>
            <option value="M">M</option>
            <option value="F">F</option>
            <option value="O">O</option>
          </select>
        </label>
        <label className="patient-field patient-field-sm">
          <span>Date</span>
          <input value={today} readOnly />
        </label>
      </div>

      {/* Main content */}
      <div className="main-stack">
        {/* Notes Panel */}
        <section className="panel notes-panel" onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) {
            learnNotes();
          }
        }}>
          <h2 className="panel-title">Clinical Notes</h2>
          <GhostInput
            value={notes}
            onChange={handleNotesChange}
            ghost={notesGhost}
            onAccept={acceptNotesGhost}
            onDismiss={() => { setNotesGhost(''); setNotesBadge(null); }}
            placeholder="c/o fever x 3 days, h/o..."
            multiline
            badge={notesBadge}
          />
        </section>

        {/* Prescription Panel */}
        <section className="panel rx-panel">
          <div className="panel-header">
            <h2 className="panel-title">Prescription</h2>
            <button className="btn btn-sm btn-primary" onClick={addRow}>+ Add Medicine</button>
          </div>
          <div className="rx-table-container">
            <div className="rx-header-row">
              <span className="rx-num">#</span>
              <span className="rx-drug-col-header">Drug</span>
              <span className="rx-col">Dose</span>
              <span className="rx-col-sm">Route</span>
              <span className="rx-col">Freq</span>
              <span className="rx-col">Duration</span>
              <span className="rx-col">Instructions</span>
              <span className="rx-remove-spacer" />
            </div>
            {rows.map((row, i) => (
              <PrescriptionRow
                key={i}
                row={row}
                index={i}
                onUpdate={updateRow}
                onRemove={removeRow}
                isOnline={isOnline}
              />
            ))}
          </div>
          <p className="rx-hint">Ctrl+Enter to add row | Tab to accept suggestion</p>
        </section>

        {/* Patient Instructions */}
        <section className="panel instructions-panel">
          <h2 className="panel-title">Patient Instructions</h2>
          <textarea
            className="instructions-textarea"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Instructions for the patient in plain language..."
            rows={3}
          />
          <div className="quick-add">
            {QUICK_INSTRUCTIONS.map((text) => (
              <button key={text} className="quick-btn" onClick={() => addQuickInstruction(text)}>
                {text}
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* Print-only layout */}
      <div className="print-only">
        <div className="print-header">
          <h1>_________________________</h1>
          <p className="print-clinic-sub">Clinic Name & Address</p>
        </div>
        <div className="print-patient">
          <span>Name: <strong>{patientName}</strong></span>
          <span>Age: <strong>{patientAge}</strong></span>
          <span>Sex: <strong>{patientSex}</strong></span>
          <span>Date: <strong>{today}</strong></span>
        </div>
        {notes && (
          <div className="print-section">
            <h3>Clinical Notes</h3>
            <p className="print-notes">{notes}</p>
          </div>
        )}
        <div className="print-section">
          <h3>Rx</h3>
          <table className="print-rx-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Drug</th>
                <th>Dose</th>
                <th>Route</th>
                <th>Frequency</th>
                <th>Duration</th>
                <th>Instructions</th>
              </tr>
            </thead>
            <tbody>
              {rows.filter(r => r.drug.trim()).map((row, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{row.drug}</td>
                  <td>{row.dose}</td>
                  <td>{row.route}</td>
                  <td>{row.frequency}</td>
                  <td>{row.duration}</td>
                  <td>{row.instructions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {instructions && (
          <div className="print-section">
            <h3>Patient Instructions</h3>
            <p className="print-instructions">{instructions}</p>
          </div>
        )}
        <div className="print-signature">
          <div className="print-sig-line" />
          <p>Doctor's Signature</p>
        </div>
      </div>
    </div>
  );
}
