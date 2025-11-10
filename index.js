import express from "express";
import axios from "axios";
import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json());

// ---------- 環境變數檢查 ----------
["OPENAI_API_KEY", "LINE_CHANNEL_TOKEN"].forEach((k) => {
  if (!process.env[k]) {
    console.warn(`[warn] env ${k} is empty!`);
  }
});

// ---------- OpenAI ----------
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 產生 AI 回覆（使用 Responses API 正確結構）
async function askCoach(userText) {
  try {
    const r = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        {
          role: "system",
          content: [
            {
              type: "text",
              text:
                "你是「Mind Coach」。用繁中、溫和、務實回覆：1) 同理一句 2) 建議一句 3) 鼓勵一句（120字內，短句、正向、有溫度，可加 emoji）。",
            },
          ],
        },
        {
          role: "user",
          content: [{ type: "text", text: userText }],
        },
      ],
    });

    // 取出文字（Responses API 最保險的取法）
    const textOut =
      r.output_text?.trim() ||
      r.output?.[0]?.content?.[0]?.text?.value?.trim() ||
      "我在這裡，願意聽你說 🙂";

    return textOut;
  } catch (err) {
    console.error("❌ OpenAI 呼叫失敗：", err.response?.data || err);
    return "我剛剛有點塞車，能再說一次嗎？🙂";
  }
}

// ---------- LINE Webhook ----------
app.post("/line/webhook", async (req, res) => {
  try {
    const events = req.body?.events || [];

    for (const event of events) {
      if (event.type === "message" && event.message?.type === "text") {
        const userText = event.message.text;
        console.log("💬 收到使用者訊息：", userText);

        const replyText = await askCoach(userText);
        console.log("🤖 AI 回覆：", replyText);

        // 回傳給 LINE
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
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("❌ LINE 回覆 API 錯誤：", error.response?.data || error);
    res.sendStatus(500);
  }
});

// ---------- 健康檢查 ----------
app.get("/", (_req, res) => res.send("OK"));

// ---------- 啟動 ----------
app.listen(process.env.PORT || 3000, () => {
  console.log("✅ Mind Coach Lite ready");
});
