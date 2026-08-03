import { GoogleGenAI } from '@google/genai';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { homeTeam, awayTeam } = req.body || {};
  if (!homeTeam || !awayTeam) {
    return res.status(400).json({ error: 'homeTeam ak awayTeam obligatwa' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const prompt = `Fè yon rechèch sou google pou match foutbòl sa a: ${homeTeam} vs ${awayTeam}.
Ba m enfòmasyon sa yo, an Kreyòl, byen estriktire an ti seksyon kout:
1) Sou sit BetMines: Win %, Draw %, Over/Under gòl %, ak BTTS % pou match sa ( Bay sèlman pousantaj ekip ki gen plis chans pou l genyen an (pa afiche lòt ekip la)).
2) Jwè blese oswa sispann pou toude ekip yo (defans ak atak).
3) Rezilta 5 dènye match ant de ekip yo (H2H), ak mwayèn gòl lakay/deyò.
4) Fòm resan (5 dènye match) chak ekip.
Rete kout ak konkrè — pa gen entwodiksyon, ale dirèkteman nan enfòmasyon yo.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: { tools: [{ googleSearch: {} }] }
    });

    return res.status(200).json({ analysis: response.text });
  } catch (err) {
    console.error('Gemini error:', err);
    return res.status(500).json({ error: 'Nou pa t ka fè rechèch la kounye a.' });
  }
}
