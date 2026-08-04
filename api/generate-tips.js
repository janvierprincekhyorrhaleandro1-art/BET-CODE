import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

 const league = m.competition?.name || 'Lòt';
const MAX_PER_RUN = 15; // limit tip generation per run so it stays fast

export default async function handler(req, res) {
  if (req.query.secret !== process.env.CRON_SECRET) {
  return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = createClient(
      'https://ennivlexjektcwfshozl.supabase.co',
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const fromDate = new Date();
    const toDate = new Date();
    toDate.setDate(toDate.getDate() + 5);
    const fromStr = fromDate.toISOString().slice(0, 10);
    const toStr = toDate.toISOString().slice(0, 10);

    const fdRes = await fetch(
      `https://api.football-data.org/v4/matches?competitions=${Object.keys(COMPETITIONS).join(',')}&dateFrom=${fromStr}&dateTo=${toStr}`,
      { headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_API_KEY } }
    );
    const fdData = await fdRes.json();
    const matches = fdData.matches || [];

    let created = 0, skipped = 0, processed = 0;
    const gratisCountByDate = {};

    for (const m of matches) {
      if (processed >= MAX_PER_RUN) break;

      const homeTeam = m.homeTeam?.name || '';
      const awayTeam = m.awayTeam?.name || '';
      const matchLabel = `${homeTeam} — ${awayTeam}`;
      const league = COMPETITIONS[m.competition?.code] || 'Lòt';
      const matchDateObj = new Date(m.utcDate);
      const matchDate = matchDateObj.toISOString().slice(0, 10);
      const kickoffTime = matchDateObj.toISOString().slice(11, 16);

      const { data: existing } = await supabase
        .from('tips').select('id')
        .eq('match_label', matchLabel).eq('match_date', matchDate).eq('source', 'ai').limit(1);
      if (existing?.length) { skipped++; continue; }

      processed++;

      const prompt = `Analize match foutbòl sa a: ${homeTeam} vs ${awayTeam}, ki ap jwe ${matchDate}.
Baze sou fòm ekip yo, istwa fasafas, ak done piblik ki disponib, bay YON sèl tip prensipal.
Reponn SÈLMAN ak yon objè JSON valid, san okenn lòt tèks, egzakteman nan fòma sa a:
{"market": "...", "pick": "...", "confidence": 75}
"market" dwe an Kreyòl (pa egzanp "Total Gòl", "Rezilta Final", "Toude Ekip Make", "Double Chans").
"confidence" se yon nonb antye ant 50 ak 95.`;

      let parsed;
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-3.5-flash',
          contents: prompt,
          config: { tools: [{ googleSearch: {} }] }
        });
        const raw = (response.text || '').trim().replace(/```json|```/g, '').trim();
        parsed = JSON.parse(raw);
      } catch (err) {
        console.error(`Erè Gemini pou ${matchLabel}:`, err);
        continue;
      }
      if (!parsed?.market || !parsed?.pick || !parsed?.confidence) continue;

      const gratisCount = gratisCountByDate[matchDate] || 0;
      let accessLevel = 'pro';
      if (gratisCount < 5) accessLevel = 'gratis';
      else if (gratisCount % 3 === 0) accessLevel = 'vip';
      gratisCountByDate[matchDate] = gratisCount + 1;

      const { error } = await supabase.from('tips').insert({
        league, match_label: matchLabel, match_date: matchDate, kickoff_time: kickoffTime,
        market: parsed.market, pick: parsed.pick, confidence: parsed.confidence,
        access_level: accessLevel, status: 'published', source: 'ai'
      });
      if (!error) created++;
    }

    return res.status(200).json({ ok: true, totalMatches: matches.length, created, skipped, processed });
  } catch (err) {
    console.error('Pipeline error:', err);
    return res.status(500).json({ error: err.message });
  }
}
