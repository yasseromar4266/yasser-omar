// سوّيلي موقع: يحول وصف المحل (بالعراقي) إلى خطة موقع كاملة بصيغة JSON، عن طريق Gemini المجاني.
// المفتاح يبقى على السيرفر وما ينشاف بالصفحة.
//
// Environment variables (Vercel → Project → Settings → Environment Variables):
//   GEMINI_API_KEY   required — free key from aistudio.google.com

export const config = { maxDuration: 60 };

const MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-3.8-flash"];
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

/* ===== نسخة احتياطية بدون ذكاء: إذا Gemini زحمة نبني الموقع من قوالب جاهزة ===== */
const FB = [
  { re:/حلويات|كيك|معجنات|حلو|بقلاوة|كنافة/, kind:"restaurant", label:"حلويات", tag:"حلاوة تنعمل كل يوم بإيدينا", font:"marhey",
    sections:[["الأكثر طلباً",[["كيك عيد ميلاد","طبقات طرية وكريمة طازجة",25000],["بقلاوة بالفستق","هشة ومحلّاة بالقطر",15000],["كنافة نابلسية","حارة وتنعمل قدامك",8000]]],["على الطلب",[["صينية عزايم","تشكيلة حلويات للضيوف",40000],["كب كيك","ألوان ونكهات حسب طلبك",2000]]]] },
  { re:/كافيه|قهوة|كوفي|مقهى/, kind:"restaurant", label:"كافيه", tag:"قعدة حلوة وقهوة تعدّل المزاج", font:"rubik",
    sections:[["المشروبات",[["لاتيه","إسبريسو وحليب مخفوق",4000],["قهوة عربية","بالهيل وتنصب حارة",2500],["موهيتو","منعش ويبرّد القلب",4500]]],["وياها",[["كرواسون","طازج كل صبح",2500],["تشيز كيك","بصوص التوت",5000]]]] },
  { re:/مطعم|اكل|أكل|مشويات|فلافل|شاورما|برگر|برجر|بيتزا|كباب|سمك|مسگوف/, kind:"restaurant", label:"مطعم", tag:"طعم البيت بس أطيب", font:"lalezar",
    sections:[["الأطباق",[["كباب عراقي","على الفحم ويا خبز حار",8000],["تكة دجاج","متبلة بخلطتنا الخاصة",7000],["قوزي","رز ولحم وكرزات",12000]]],["المقبلات",[["حمص","بزيت الزيتون",2000],["سلطة","خضرة طازجة",1500]]]] },
  { re:/صالون|حلاق|حلاقة|تجميل|مكياج|ميك اب|بيوتي/, kind:"service", label:"صالون", tag:"طلّة تفرق وتنشاف من بعيد", font:"elmessiri",
    sections:[["الخدمات",[["قص شعر","حسب شكل وجهك",7000],["تحديد لحية","خطوط نظيفة ومرتبة",4000],["عناية بالبشرة","تنظيف وترطيب",15000]]]] },
  { re:/مدرس|تدريس|دروس|خصوصي|معهد|كورس|دورة/, kind:"service", label:"دروس", tag:"نفهمك الدرس من أوله لآخره", font:"tajawal",
    sections:[["الدروس",[["درس خصوصي","حصة فردية بالبيت أو أونلاين",25000],["مراجعة امتحانات","حل أسئلة وزارية",20000],["مجموعة صغيرة","4 طلاب بالحصة",15000]]]] },
  { re:/تصليح|صيانة|كهربائي|سباك|موبايلات|تبريد|ورشة/, kind:"service", label:"صيانة", tag:"نصلحها صح من أول مرة", font:"rubik",
    sections:[["الخدمات",[["فحص وتشخيص","نعرف العطل بدقايق",5000],["تصليح","قطع أصلية ويا ضمان",null],["زيارة للبيت","نوصلك وين ما تكون",10000]]]] },
  { re:/ملابس|ازياء|أزياء|عبايات|احذية|أحذية|اطفال|أطفال|بوتيك/, kind:"store", label:"ملابس", tag:"موديلات جديدة كل أسبوع", font:"elmessiri",
    sections:[["وصل جديد",[["طقم صيفي","قطن ناعم ومريح",25000],["جاكيت","يناسب كل الطلعات",35000],["حذاء رياضي","خفيف ومريح",30000]]],["عروض",[["قطعتين بسعر وحدة","لفترة محدودة",null]]]] },
];
const PALETTES = [
  { bg:"#fbf6ee", surface:"#ffffff", ink:"#2b1d14", accent:"#c2410c", accentInk:"#ffffff" },
  { bg:"#f1f7f4", surface:"#ffffff", ink:"#12312a", accent:"#0f766e", accentInk:"#ffffff" },
  { bg:"#fff8e7", surface:"#ffffff", ink:"#2a2112", accent:"#b45309", accentInk:"#ffffff" },
  { bg:"#f4f1ea", surface:"#fffdf8", ink:"#1f2933", accent:"#1d4ed8", accentInk:"#ffffff" },
  { bg:"#fdf2f2", surface:"#ffffff", ink:"#3b1219", accent:"#be123c", accentInk:"#ffffff" },
];
function fallback(prompt) {
  const t = FB.find(k => k.re.test(prompt)) || { kind:"store", label:"محل", tag:"كل اللي تحتاجه بمكان واحد", font:"tajawal",
    sections:[["منتجاتنا",[["منتج مميز","جودة تستاهل",10000],["الأكثر مبيعاً","الكل يطلبه",15000],["جديدنا","وصل هالأسبوع",12000]]]] };
  const nm = prompt.match(/(?:اسمه|اسمها|اسم المحل|اسمنا)\s*[:"«]?\s*([^\s،,.\n"»]+(?:\s+[^\s،,.\n"»]+)?)/);
  const ar = prompt.match(/(?:ب|في|بمنطقة|منطقة)\s*(المنصور|الكرادة|زيونة|الجادرية|الأعظمية|الاعظمية|الكاظمية|الدورة|الشعب|البياع|اليرموك|العامرية|الحارثية|السيدية|الغدير|بغداد الجديدة|البصرة|أربيل|اربيل|النجف|كربلاء|الموصل|الحلة|[^\s،,.]+ية)/);
  const area = ar ? ar[1] : "بغداد";
  const name = nm ? nm[1] : `${t.label} ${area}`;
  const pal = PALETTES[Math.floor(Math.random() * PALETTES.length)];
  return {
    kind: t.kind, name, name_en: "", tagline: t.tag,
    hero: `أهلاً بيكم ب${name}`,
    about: prompt.length > 30 ? prompt.slice(0, 220) : `${name} بمنطقة ${area}، نشتغل بحب ونهتم بكل زبون كأنه من أهل البيت.`,
    area, hours: "كل يوم من 10 الصبح لحد 11 بالليل", cta: t.kind === "service" ? "احجز موعد" : "اطلب هسه",
    palette: pal, font: t.font,
    sections: t.sections.map(([title, items]) => ({ title, items: items.map(([n, d, p]) => ({ name:n, desc:d, price: p ? p.toLocaleString("en-US") + " د.ع" : "حسب الطلب" })) })),
    highlights: ["أسعار مناسبة", "توصيل لكل مناطق " + (/(البصرة|أربيل|اربيل|النجف|كربلاء|الموصل|الحلة)/.test(area) ? area : "بغداد"), "نرد عالواتساب بسرعة"],
    fallback: true,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(200).json(clean(fallback(String((req.body||{}).prompt||""))));

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0] || "x";
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 60 * 60_000);
  if (list.length >= 12) return res.status(429).json({ error: "limit" });
  list.push(now); hits.set(ip, list);

  const prompt = String((req.body || {}).prompt || "").trim().slice(0, 600);
  if (prompt.length < 4) return res.status(400).json({ error: "short" });

  // نجرب أكثر من موديل، ونعيد المحاولة إذا Gemini زحمة، وكلها لازم تخلص قبل 55 ثانية
  const errs = []; const start = Date.now(); let busy = false;
  for (let round = 0; round < 2; round++) {
    for (const m of MODELS) {
      const left = 30000 - (Date.now() - start);
      if (left < 5000) break;
      try { return res.status(200).json(clean(await ask(m, prompt, key, Math.min(15000, left - 500)))); }
      catch (e) {
        const msg = String(e?.message || e);
        if (/high demand|overloaded|503|UNAVAILABLE|429|quota/i.test(msg) || e?.status === 503 || e?.status === 429) busy = true;
        errs.push(m + ": " + msg.slice(0, 120));
      }
    }
    if (30000 - (Date.now() - start) < 8000) break;
    await new Promise(r => setTimeout(r, 1500));
  }
  // الذكاء ما رد؟ نطلع نسخة من القوالب حتى الزائر ما يطلع إيده فارغة
  res.setHeader("x-ai-detail", encodeURIComponent(errs.slice(-2).join(" | ").slice(0, 300)));
  return res.status(200).json(clean(fallback(prompt)));
}
