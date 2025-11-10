import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import OpenAI from "openai";
import axios from "axios";

dotenv.config();

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 讓回覆更口語＆帶 emoji 的對照表
const emotionEmoji = {
  喜悅: "😊",
  開心: "😊",
  放鬆: "😌",
  平靜: "🫶",
  緊張: "😬",
  焦慮: "😟",
  難過: "😢",
  生氣: "😠",
  挫折: "🥲",
  沮喪: "😞",
  擔心: "😰",
};

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    emotion: { type: "string" },
    score: { type: "number" },
    triggers: { type: "array", items: { type: "string" }, maxItems: 3 },
    advice: { type: "string", maxLength: 120 },
    rewrite: { type: "string", maxLength: 60 },
  },
  required: ["emotion", "score", "advice", "rewrite"],
};

// 產生帶 emoji 的回覆文字
function formatReply(out = {}) {
  const emo = out.emotion || "-";
  const emoIcon =
    emotionEmoji[emo] ||
    (emo.includes("喜") || emo.includes("樂") ? "😊" : "🫶");

  const scoreIcon =
    out.score >= 80 ? "🌟" : out.score >= 60 ? "👍" : out.score >= 40 ? "🧭" : "🤝";

  return (
    `${emoIcon} 情緒：${emo}\n` +
    `${scoreIcon} 分數：${out.score ?? "-"} / 100\n` +
    `💡 建議：${out.advice ?? "-"}\n` +
    `✍️ 重寫：${out.rewrite ?? "-"}`
  );
}

async function askCoach(text) {
  const r = await client.responses.create({
    model: "gpt-4o-mini",
    input: [
      {
        role: "system",
        content:
          "你是「Mind Coach」。用繁中、溫和、務實：1) emotion 2) score(0-100) 3) triggers(<=3詞) 4) advice<120字 5) rewrite<60字；短句、正向、不說教。",
      },
      { role: "user", content: text },
    ],
    text: {
      format: "json_schema",
      json_schema: { name: "MindCoach", schema, strict: true },
    },
  });

  const out = r.output_parsed || {};
  return formatReply(out);
}

const app = express();
app.use(bodyParser.json());

// 健康檢查
app.get("/", (_req, res) => res.send("OK"));

// LINE webhook
app.post("/line/webhook", async (req, res) => {
  const events = req.body?.events || [];

  for (const event of events) {
    if (event.type !== "message" || event.message?.type !== "text") continue;

    const userText = event.message.text;
    let replyText = "✅ 我收到你的訊息囉～";

    try {
      replyText = await askCoach(userText);
    } catch (error) {
      console.error("❌ AI 回覆錯誤：", error.response?.data || error);
    }

    try {
      await axios.post(
        "https://api.line.me/v2/bot/message/reply",
        {
          replyToken: event.replyToken,
          messages: [{ type: "text", text: replyText }],
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.LINE_CHANNEL_TOKEN}`,
          },
        }
      );
    } catch (error) {
      console.error("❌ LINE 回覆 API 錯誤：", error.response?.data || error);
    }
  }

  res.sendStatus(200);
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Mind Coach Lite ready");
});
