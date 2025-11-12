import express from "express";
import axios from "axios";
import OpenAI from "openai";
import dotenv from "dotenv";
import crypto from "crypto";
dotenv.config();

const app = express();

// -------- 基本設定 --------
["OPENAI_API_KEY", "LINE_CHANNEL_TOKEN", "LINE_CHANNEL_SECRET"].forEach((k) => {
  if (!process.env[k]) console.warn(`[⚠️ warn] env ${k} is empty!`);
});

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// -------- LINE 驗簽需 raw body --------
app.post(
  "/line/webhook",
  express.raw({ type: "application/json" }), // 取得原始 body（Buffer）
  (req, res, next) => {
    const signature = req.headers["x-line-signature"];
    if (!signature) return res.sendStatus(400);

    const hmac = crypto
      .createHmac("sha256", process.env.LINE_CHANNEL_SECRET || "")
      .update(req.body) // Buffer 原文
      .digest("base64");

    if (hmac !== signature) return res.sendStatus(403);

    // 驗簽通過後把 body 轉回物件
    try {
      req.body = JSON.parse(req.body.toString("utf8"));
    } catch {
      return res.sendStatus(400);
    }
    next();
  },
  async (req, res) => {
    try {
      const events = req.body?.events || [];
      if (!Array.isArray(events) || events.length === 0) return res.sendStatus(200);

      for (const event of events) {
        const replyToken = event.replyToken;
        if (!replyToken) continue;

        if (event.type === "message" && event.message?.type === "text") {
          const userText = (event.message.text || "").slice(0, 1000);
          console.log("💬 使用者：", userText);

          const replyText = await askCoach(userText);
          console.log("🧠 AI raw =", replyText);
          await sendLineReply(replyToken, replyText);
        } else {
          await sendLineReply(
            replyToken,
            "目前先支援文字訊息（貼圖/圖片我暫時看不到），想跟我聊聊嗎？📝"
          );
        }
      }
      res.sendStatus(200);
    } catch (error) {
      console.error("❌ LINE webhook 處理錯誤：", error?.response?.data || error);
      res.sendStatus(500);
    }
  }
);

// -------- OpenAI 回覆（穩定+診斷）--------
async function askCoach(userText) {
  try {
    const input = (userText || "").toString().slice(0, 1000);

    // ✅ timeout 放在第二個參數
    const completion = await client.chat.completions.create(
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "你是「Mind Coach」，一位善解人意、會聊天的心理陪伴者。請用自然的繁中語氣，像朋友一樣聊天，不要太制式。每次回覆可包含同理、建議、鼓勵三部分，但語氣要自然、口語、有溫度（約100字內，可加 emoji，不要像課本）。"
          },
          { role: "user", content: input }
        ],
        temperature: 0.7,
        max_tokens: 150
      },
      { timeout: 8000 }
    );

    const ai = completion.choices?.[0]?.message?.content?.trim();
    if (ai) return ai;

    console.warn("⚠️ AI empty, use fallback");
    return randomFallback(input);
  } catch (err) {
    const code = err?.code || err?.error?.code;
    const status = err?.status || err?.response?.status;
    const msg =
      err?.response?.data?.error?.message || err?.message || JSON.stringify(err);
    console.error("❌ OpenAI error detail:", { code, status, msg });

    if (code === "insufficient_quota" || status === 429) {
      return "AI 額度暫時用完了，但我在這裡陪你。想說說看發生了什麼嗎？🙂";
    }
    return "剛剛有點塞車，再說一次也可以喔 🙂";
  }
}

function randomFallback(seed = "") {
  const fallbacks = [
    "我在，先陪你一下。想從哪一段開始說呢？🙂",
    "我懂，你先深呼吸，我在這裡聽你說。🙂",
    "辛苦了，我願意陪你聊聊。你最在意的是哪件事？🙂",
    "收到，我在。說說現在最困擾你的點吧。🙂",
    "我在旁邊，慢慢來。我們一步一步整理。🙂"
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return fallbacks[h % fallbacks.length];
}

// -------- LINE 回覆（含 429/5xx 自動重試）--------
async function sendLineReply(replyToken, text) {
  const payload = { replyToken, messages: [{ type: "text", text }] };
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.LINE_CHANNEL_TOKEN}`
  };

  const maxRetries = 2;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      await axios.post("https://api.line.me/v2/bot/message/reply", payload, {
        headers,
        timeout: 10000
      });
      return;
    } catch (err) {
      const status = err?.response?.status;
      if (i < maxRetries && (status === 429 || (status >= 500 && status < 600))) {
        const backoff = 300 * (i + 1);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      console.error("❌ LINE 回覆失敗：", err?.response?.data || err);
      throw err;
    }
  }
}

// -------- 健康/診斷/直接測 AI --------
app.get("/", (_req, res) => res.send("Mind Coach Lite OK"));

app.get("/_health", (_req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    node: process.version,
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    hasLineToken: !!process.env.LINE_CHANNEL_TOKEN,
    hasLineSecret: !!process.env.LINE_CHANNEL_SECRET,
    commit: process.env.RENDER_GIT_COMMIT || "unknown"
  });
});

app.get("/_diag", (_req, res) => {
  res.json({
    node: process.version,
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    hasLineToken: !!process.env.LINE_CHANNEL_TOKEN,
    hasLineSecret: !!process.env.LINE_CHANNEL_SECRET
  });
});

app.get("/test-ai", async (req, res) => {
  try {
    const text = (req.query.text || "測試").toString().slice(0, 200);
    const r = await client.chat.completions.create(
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "請用繁中回覆，一句話即可。" },
          { role: "user", content: text }
        ],
        max_tokens: 60,
        temperature: 0.7
      },
      { timeout: 8000 } // 同樣放第二個參數
    );
    const ai = r.choices?.[0]?.message?.content?.trim();
    res.json({ ok: true, ai });
  } catch (err) {
    const code = err?.code || err?.error?.code;
    const status = err?.status || err?.response?.status;
    const msg =
      err?.response?.data?.error?.message || err?.message || JSON.stringify(err);
    res.status(500).json({ ok: false, code, status, msg });
  }
});

// -------- 啟動＆優雅關機 --------
const server = app.listen(process.env.PORT || 3000, () => {
  console.log("✅ Mind Coach Lite ready");
});
process.on("SIGTERM", () => {
  console.log("⏳ Shutting down...");
  server.close(() => process.exit(0));
});
