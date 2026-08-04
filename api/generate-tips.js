export default async function handler(req, res) {
  try {
    if (req.query.secret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Check every required env var explicitly, one by one
    const required = ['GEMINI_API_KEY', 'FOOTBALL_DATA_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET'];
    const missing = required.filter(k => !process.env[k]);
    if (missing.length > 0) {
      return res.status(500).json({ step: 'env_check', error: 'Varyab sa yo manke sou Vercel: ' + missing.join(', ') });
    }

    let GoogleGenAI, createClient;
    try {
      ({ GoogleGenAI } = await import('@google/genai'));
      ({ createClient } = await import('@supabase/supabase-js'));
    } catch (err) {
      return res.status(500).json({ step: 'import', error: 'Pa ka chaje pake yo (package.json?): ' + err.message });
    }

    let supabase, ai;
    try {
      supabase = createClient('https://ennivlexjektcwfshozl.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY);
      ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    } catch (err) {
      return res.status(500).json({ step: 'client_init', error: err.message });
    }

    const COMPETITIONS = {
      PL: 'Premier League', PD: 'Liga', BL1: 'Bundesliga',
      SA: 'Serie A', FL1: 'Ligue 1', CL: 'Lig dè Chanpyon'
    };
    const MAX_PER_RUN = 15;

    const fromDate = new Date();
    const toDate = new Date();
    toDate.setDate(toDate.getDate() + 5);
    const fromStr = fromDate.toISOString().slice(0, 10);
    const toStr = toDate.toISOString().slice(0, 10);

    let matches;
    try {
      const fdRes = await fetch(
        `https://api.football-data.org/v4/matches?competitions=${Object.keys(COMPETITIONS).join(',')}&dateFrom=${fromStr}&dateTo=${toStr}`,
        { headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_API_KEY } }
      );
      const fdData = await fdRes.json();
      if (!fdRes.ok) {
        return res.status(500).json({ step: 'football_data', error: fdData.message || JSON.stringify(fdData), status: fdRes.status });
      }
      matches = fdData.matches || [];
    } catch (err) {
      return res.status(500).json({ step: 'football_data_fetch', error: err.message });
    }

    let created = 0, skipped = 0, processed = 0;
    const gratisCountByDate = {};
    const errors = [];

    for (const m of matches) {
      if (processed >= MAX_PER_RUN) break;

      const homeTeam = m.homeTeam?.name || '';
      const awayTeam = m.awayTeam?.name || '';
      const matchLabel = `${homeTeam} — ${awayTeam}`;
      const league = m.competition?.name || 'Lòt';
      const matchDateObj = new Date(m.utcDate);
      const matchDate = matchDateObj.toISOString().slice(0, 10);
      const kickoffTime = matchDateObj.toISOString().slice(11, 16);

      try {
        const { data: existing, error: selErr } = await supabase
          .from('tips').select('id')
          .eq('match_label', matchLabel).eq('match_date', matchDate).eq('source', 'ai').limit(1);
        if (selErr) { errors.push({ step: 'select', match: matchLabel, error: selErr.message }); continue; }
        if (existing?.length) { skipped++; continue; }
      } catch (err) {
        errors.push({ step: 'select_catch', match: matchLabel, error: err.message });
        continue;
      }

      processed++;

      let parsed;
      try {
        const prompt = `Analize match foutbòl sa a: ${homeTeam} vs ${awayTeam}, ki ap jwe ${matchDate}.
Baze sou fòm ekip yo, istwa fasafas, ak done piblik ki disponib, bay YON sèl tip prensipal.
Reponn SÈLMAN ak yon objè JSON valid, san okenn lòt tèks, egzakteman nan fòma sa a:
{"market": "...", "pick": "...", "confidence": 75}
"market" dwe an Kreyòl. "confidence" se yon nonb antye ant 50 ak 95.`;

        const response = await ai.models.generateContent({
          model: 'gemini-3.5-flash',
          contents: prompt,
          config: { tools: [{ googleSearch: {} }] }
        });
        const raw = (response.text || '').trim().replace(/```json|```/g, '').trim();
        parsed = JSON.parse(raw);
      } catch (err) {
        errors.push({ step: 'gemini', match: matchLabel, error: err.message });
        continue;
      }
      if (!parsed?.market || !parsed?.pick || !parsed?.confidence) continue;

      const gratisCount = gratisCountByDate[matchDate] || 0;
      let accessLevel = 'pro';
      if (gratisCount < 5) accessLevel = 'gratis';
      else if (gratisCount % 3 === 0) accessLevel = 'vip';
      gratisCountByDate[matchDate] = gratisCount + 1;

      try {
        const { error: insErr } = await supabase.from('tips').insert({
          league, match_label: matchLabel, match_date: matchDate, kickoff_time: kickoffTime,
          market: parsed.market, pick: parsed.pick, confidence: parsed.confidence,
          access_level: accessLevel, status: 'published', source: 'ai'
        });
        if (insErr) { errors.push({ step: 'insert', match: matchLabel, error: insErr.message }); continue; }
        created++;
      } catch (err) {
        errors.push({ step: 'insert_catch', match: matchLabel, error: err.message });
      }
    }

    return res.status(200).json({ ok: true, totalMatches: matches.length, created, skipped, processed, errors });
  } catch (err) {
    return res.status(500).json({ step: 'top_level', error: err.message, stack: err.stack });
  }
  }
