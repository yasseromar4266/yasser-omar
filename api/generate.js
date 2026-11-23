// سوّيلي موقع: يحول وصف المحل (بالعراقي) إلى خطة موقع كاملة بصيغة JSON، عن طريق Gemini المجاني.
// المفتاح يبقى على السيرفر وما ينشاف بالصفحة.
//
// Environment variables (Vercel → Project → Settings → Environment Variables):
//   GEMINI_API_KEY   required — free key from aistudio.google.com

export const config = { maxDuration: 60 };

const MODELS = ["gemini-flash-lite-latest", "gemini-2.5-flash-lite", "gemini-flash-latest", "gemini-2.5-flash"];
const hits = new Map();

const KINDS = ["store", "restaurant", "service"];
const SCHEMA = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: KINDS },
    name: { type: "STRING" },
    name_en: { type: "STRING" },
    tagline: { type: "STRING" },
    hero: { type: "STRING" },
    about: { type: "STRING" },
    area: { type: "STRING" },
    hours: { type: "STRING" },
    cta: { type: "STRING" },
    palette: {
      type: "OBJECT",
      properties: { bg: { type: "STRING" }, surface: { type: "STRING" }, ink: { type: "STRING" }, accent: { type: "STRING" }, accentInk: { type: "STRING" } },
      required: ["bg", "surface", "ink", "accent", "accentInk"],
    },
    font: { type: "STRING", enum: ["lalezar", "elmessiri", "rubik", "amiri", "marhey", "tajawal"] },
    sections: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          items: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { name: { type: "STRING" }, desc: { type: "STRING" }, price: { type: "STRING" } },
              required: ["name"],
            },
          },
        },
        required: ["title", "items"],
      },
    },
    highlights: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["kind", "name", "tagline", "hero", "about", "palette", "font", "sections", "highlights", "cta"],
};

const SYSTEM = `إنت مصمم مواقع عراقي. الزبون راح يوصفلك محله أو شغله بالعراقي، وإنت تطلع خطة موقع واحد لمحله.
القواعد:
- اكتب كل النصوص بلهجة عراقية بيضاء مفهومة، قصيرة وحلوة، بدون مبالغة ولا كلمات إنكليزية إلا اسم المحل بالإنكليزي في name_en.
- kind: store للمحلات اللي تبيع بضاعة، restaurant للمطاعم والكافيهات والحلويات والأفران، service للصالونات والعيادات والورش والخدمات والمدرسين.
- إذا الزبون ما ذكر اسم، اخترع اسم عراقي حلو يناسب. إذا ذكر منطقة حطها في area.
- sections: من 2 إلى 4 أقسام. كل قسم من 3 إلى 6 عناصر واقعية تناسب المحل بالعراق. price بالدينار العراقي مثل "5,000 د.ع" أو اتركه فارغ إذا ما يناسب.
- highlights: 3 مميزات قصيرة (2 إلى 4 كلمات) مثل "توصيل لكل بغداد".
- hours: أوقات دوام واقعية. cta: نص زر قصير للطلب بالواتساب مثل "اطلب هسه".
- palette: ألوان hex تناسب طبيعة المحل، مو بنفسجي افتراضي. bg خلفية، surface للبطاقات، ink للكتابة ولازم تكون مقروءة على bg وsurface، accent لون مميز، accentInk لون الكتابة فوق accent.
- font: اختار خط يناسب: lalezar للشعبي القوي، elmessiri للأنيق، rubik للحديث، amiri للفخم الكلاسيكي، marhey للمرح، tajawal للبسيط.
- لا تكتب أي شي غير مناسب أو مسيء، وإذا الطلب مو عن محل أو شغل، سوي موقع لمحل عراقي عادي.`;

async function ask(model, prompt, key, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 2200, responseMimeType: "application/json", responseSchema: SCHEMA },
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data?.error?.message || "upstream"); e.status = r.status; throw e; }
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
    return JSON.parse(text);
  } finally { clearTimeout(t); }
}

const hex = v => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim() : null);
function clean(spec) {
  const p = spec.palette || {};
  spec.palette = {
    bg: hex(p.bg) || "#fbf6ee", surface: hex(p.surface) || "#ffffff", ink: hex(p.ink) || "#2a1d14",
    accent: hex(p.accent) || "#c2452d", accentInk: hex(p.accentInk) || "#ffffff",
  };
  if (!KINDS.includes(spec.kind)) spec.kind = "store";
  spec.sections = (spec.sections || []).slice(0, 4).map(s => ({ title: String(s.title || "").slice(0, 60), items: (s.items || []).slice(0, 6) }));
  spec.highlights = (spec.highlights || []).slice(0, 3);
  return spec;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ error: "nokey" });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0] || "x";
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 60 * 60_000);
  if (list.length >= 12) return res.status(429).json({ error: "limit" });
  list.push(now); hits.set(ip, list);

  const prompt = String((req.body || {}).prompt || "").trim().slice(0, 600);
  if (prompt.length < 4) return res.status(400).json({ error: "short" });

  // نجرب أكثر من موديل: إذا واحد زحمة أو بطيء نروح للي بعده، وكلها لازم تخلص قبل 55 ثانية
  let lastErr; const start = Date.now();
  for (const m of MODELS) {
    const left = 55000 - (Date.now() - start);
    if (left < 6000) break;
    try { return res.status(200).json(clean(await ask(m, prompt, key, Math.min(25000, left - 1000)))); }
    catch (e) { lastErr = e; }
  }
  return res.status(502).json({ error: "ai", detail: String(lastErr?.message || "").slice(0, 200) });
}
