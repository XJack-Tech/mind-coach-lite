import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';
import OpenAI from 'openai';

const app = express();
app.use(bodyParser.json());
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const schema = {
  type: "object",
  properties: {
    emotion: { type: "string", enum: ["開心","平靜","緊張","焦慮","沮喪","憤怒","疲憊","孤單","感恩"] },
    score: { type: "integer", minimum: 0, maximum: 100 },
    triggers: { type: "array", items: { type: "string" } },
    advice: { type: "string" },
    rewrite: { type: "string" }
  },
  required: ["emotion","score","advice"],
  additionalProperties: false
};

app.post('/line/webhook', async (req, res) => {
  try {
    for (const event of req.body.events || []) {
      if (event.type === 'message' && event.message.type === 'text') {
        const text = (event.message.text || '').slice(0, 800);

        const r = await client.responses.create({
          model: "gpt-4o-mini",
          input: [
            { role: "system", content:
              "你是「Mind Coach」。用繁中、溫和、務實：1) emotion 2) score(0-100) 3) triggers(<=3詞) 4) advice<120字 5) rewrite<60字；短句、正向、不說教。" },
            { role: "user", content: text }
          ],
          response_format: { type: "json_schema", json_schema: { name: "MindCoach", schema, strict: true } }
        });

        const out = JSON.parse(r.output_text || "{}");

        const reply = `感受：${out.emotion}（${out.score}/100）
建議：${out.advice}
換個說法：${out.rewrite || ""}`.trim();

        await axios.post(
          "https://api.line.me/v2/bot/message/reply",
          { replyToken: event.replyToken, messages: [{ type: "text", text: reply }] },
          { headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_TOKEN}` } }
        );
      }
    }
    res.sendStatus(200);
  } catch (e) {
    console.error(e?.response?.data || e);
    res.sendStatus(200);
  }
});

app.get('/', (_, res) => res.send('OK'));
app.listen(process.env.PORT || 3000, () => console.log('Mind Coach Lite ready'));
