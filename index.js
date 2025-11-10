const r = await client.responses.create({
  model: "gpt-4o-mini",
  input: [
    {
      role: "system",
      content: "你是「Mind Coach」。用繁中、溫和、務實：1) emotion 2) score(0-100) 3) triggers(<=3詞) 4) advice<120字 5) rewrite<60字；短句、正向、不說教。"
    },
    { role: "user", content: text }
  ],
  text: {
    format: "json_schema",
    json_schema: { name: "MindCoach", schema, strict: true }
  }
});

const out = r.output_parsed || {};
