"""Synthetic statement dataset generator for the Health-Bridge statement classifier.

Every example produced here is **synthetic**. Nothing is scraped, and no real patient
data is used. See `data/dataset.jsonl` for the generated corpus and
`data/data_manifest.json` for provenance and label counts.

Design notes
------------
* Each row belongs to a `scenario_id`. All rows in one scenario share a template family,
  so the train/validation/test split **groups by scenario** and closely related examples
  never leak across splits.
* Templates are written in English, Devanagari Hindi, and Roman-script Hinglish. The
  generator assigns languages per example so the corpus has measurable per-language
  subsets instead of a claim we cannot evaluate.
* Labels are documentation categories (`symptom`, `duration`, `medication`, `allergy`,
  `medical_history`, `other`) — never diagnoses.

Run:
    python ml/generate_dataset.py
"""

from __future__ import annotations

import hashlib
import json
import random
from pathlib import Path

SEED = 20261019
DATASET_VERSION = "synthetic-statements-v1"
OUT_DIR = Path(__file__).resolve().parent / "data"

LABELS = ["symptom", "duration", "medication", "allergy", "medical_history", "other"]
LANGUAGES = ["en", "hi", "hinglish"]

# --------------------------------------------------------------------------------------
# Template banks
#
# Each entry is (english, hindi, hinglish). `body` is the statement itself; `{slot}`
# placeholders are filled from the slot banks below so a template can yield many
# distinct statements while staying in the same scenario family.
# --------------------------------------------------------------------------------------

SYMPTOM_SLOTS = [
    ("a sore throat", "गले में दर्द", "gale mein dard"),
    ("a headache", "सिरदर्द", "sir dard"),
    ("a burning pain in my chest", "सीने में जलन", "seene mein jalan"),
    ("blurred vision", "धुंधला दिखना", "dhundhla dikhna"),
    ("itching on my arms", "बाजुओं में खुजली", "baahon mein khujli"),
    ("a cough at night", "रात में खांसी", "raat mein khansi"),
    ("swelling in my feet", "पैरों में सूजन", "pairon mein sujan"),
    ("pain while passing urine", "पेशाब में जलन", "peshab mein jalan"),
    ("a stomach ache after eating", "खाने के बाद पेट दर्द", "khane ke baad pet dard"),
    ("clogged ears", "कान बंद होना", "kaan band hona"),
    ("numbness in my fingers", "उंगलियों में सुन्नपन", "ungliyon mein sunnpan"),
    ("a rash with small bumps", "छोटे दानों वाला लाल चकत्ता", "chote daanon wala laal chakat"),
    ("shortness of breath while climbing stairs", "सीढ़ी चढ़ते समय सांस फूलना", "seedhi chadhte waqt saans phulna"),
    ("low back pain", "कमर में दर्द", "kamar mein dard"),
    ("heavy bleeding during my period", "माहवारी में ज्यादा खून आना", "mahwari mein zyada khoon aana"),
    ("a fever with chills", "ठंड लगकर बुखार", "thand lagkar bukhar"),
    ("loose motions since morning", "सुबह से दस्त", "subah se dast"),
    ("joint pain in both knees", "दोनों घुटनों में दर्द", "dono ghutno mein dard"),
    ("vomiting after meals", "खाने के बाद उल्टी", "khane ke baad ulti"),
    ("a headache with light sensitivity", "रोशनी में सिरदर्द बढ़ना", "roshni mein sir dard badhna"),
    ("a throbbing pain on one side of my head", "सिर के एक तरफ तेज दर्द", "sir ke ek taraf tez dard"),
    ("difficulty swallowing food", "खाना निगलने में कठिनाई", "khana nigalne mein kathinai"),
    ("a dry cough that does not stop", "जो रुकती नहीं ऐसी सूखी खांसी", "jo rukti nahi aisi sookhi khansi"),
    ("chest tightness when I walk fast", "तेज चलने पर सीने में जकड़न", "tez chalne par seene mein jakdan"),
    ("a burning sensation while urinating", "पेशाब करते समय जलन", "peshab karte samay jalan"),
    ("a constant ringing in my ears", "कानों में लगातार आवाज", "kaanon mein lagatar awaaz"),
    ("a lump in my neck that is growing", "गर्दन में बढ़ती गांठ", "gardan mein badhti gaanth"),
    ("yellowing of my eyes", "आंखों का पीलापन", "aankhon ka peelapan"),
    ("excessive thirst through the day", "दिन भर अत्यधिक प्यास", "din bhar atyadhik pyaas"),
    ("my hands shaking while holding things", "चीजें पकड़ते समय हाथ कांपना", "cheezein pakadte samay haath kaanpna"),
    ("a painful swelling in my armpit", "बगल में दर्दभरी सूजन", "bagal mein dardbhari sujan"),
    ("trouble falling asleep at night", "रात में नींद न आना", "raat mein neend na aana"),
    ("a white patch on my tongue", "जीभ पर सफेद दाग", "jeebh par safed daag"),
    ("cramps in my legs at night", "रात में पैरों में अकड़न", "raat mein pairon mein akdan"),
    ("sudden weakness on my left side", "बाईं तरफ अचानक कमजोरी", "baayi taraf achanak kamzori"),
    ("pain in my upper abdomen after tea", "चाय के बाद ऊपरी पेट में दर्द", "chai ke baad upari pet mein dard"),
    ("my eyes watering constantly", "आंखों से लगातार पानी आना", "aankhon se lagatar paani aana"),
    ("bleeding gums while brushing", "ब्रश करते समय मसूड़ों से खून", "brush karte samay masudon se khoon"),
    ("a hoarse voice since yesterday", "कल से आवाज बैठी हुई", "kal se awaaz baithi hui"),
]

DURATION_SLOTS = [
    ("two days", "दो दिन", "do din"),
    ("three weeks", "तीन हफ्ते", "teen hafte"),
    ("about six hours", "करीब छह घंटे", "karib chhe ghante"),
    ("since last Monday", "पिछले सोमवार से", "pichhle somwar se"),
    ("for the past month", "पिछले एक महीने से", "pichhle ek mahine se"),
    ("on and off for a year", "एक साल से रुक-रुक कर", "ek saal se ruk ruk kar"),
    ("just this morning", "आज सुबह ही", "aaj subah hi"),
    ("since childhood", "बचपन से", "bachpan se"),
    ("for ten days now", "अब दस दिन से", "ab das din se"),
    ("a few minutes ago", "कुछ मिनट पहले", "kuch minute pehle"),
    ("every winter", "हर सर्दी में", "har sardi mein"),
    ("since I started a new job", "नई नौकरी शुरू करने के बाद से", "nayi naukri shuru karne ke baad se"),
    ("for two hours after each meal", "हर खाने के बाद दो घंटे तक", "har khane ke baad do ghante tak"),
    ("slowly over four months", "धीरे-धीरे चार महीनों में", "dheere dheere chaar mahino mein"),
    ("only at night", "सिर्फ रात में", "sirf raat mein"),
    ("since my delivery", "डिलीवरी के बाद से", "delivery ke baad se"),
    ("for the last eighteen months", "पिछले अठारह महीनों से", "pichhle atharah mahino se"),
    ("after every meal for a week", "एक हफ्ते से हर खाने के बाद", "ek hafte se har khane ke baad"),
    ("since I changed my medication", "दवा बदलने के बाद से", "dawa badalne ke baad se"),
    ("during the monsoon every year", "हर साल मानसून में", "har saal monsoon mein"),
    ("for exactly one week", "ठीक एक हफ्ते से", "theek ek hafte se"),
]

MEDICATION_SLOTS = [
    ("metformin 500 mg twice a day", "मेटफॉर्मिन 500 मिलीग्राम दिन में दो बार", "metformin 500 mg din mein do baar"),
    ("insulin every morning", "हर सुबह इंसुलिन", "har subah insulin"),
    ("amlodipine 5 mg at night", "रात में एम्लोडिपिन 5 मिलीग्राम", "raat mein amlodipine 5 mg"),
    ("paracetamol when the fever rises", "बुखार बढ़ने पर पैरासिटामोल", "bukhar badhne par paracetamol"),
    ("an inhaler twice daily", "दिन में दो बार इनहेलर", "din mein do baar inhaler"),
    ("thyroid tablets before breakfast", "नाश्ते से पहले थायरॉइड की गोली", "nashte se pehle thyroid ki goli"),
    ("iron and folic acid tablets", "आयरन और फोलिक एसिड की गोलियां", "iron aur folic acid ki goliyan"),
    ("an antacid after lunch", "दोपहर के खाने के बाद एंटासिड", "dopahar ke khane ke baad antacid"),
    ("a blood thinner daily", "रोज खून पतला करने की दवा", "roz khoon patla karne ki dawa"),
    ("eye drops three times a day", "दिन में तीन बार आई ड्रॉप", "din mein teen baar eye drop"),
    ("vitamin D once a week", "हफ्ते में एक बार विटामिन डी", "hafte mein ek baar vitamin D"),
    ("an antibiotic course for five days", "पांच दिन का एंटीबायोटिक कोर्स", "paanch din ka antibiotic course"),
    ("painkillers only when needed", "जरूरत पड़ने पर ही दर्द निवारक", "zaroorat padne par hi dard nivarak"),
    ("a steroid cream on the rash", "चकत्ते पर स्टेरॉयड क्रीम", "chakatte par steroid cream"),
    ("atenolol 25 mg each morning", "हर सुबह एटेनोलोल 25 मिलीग्राम", "har subah atenolol 25 mg"),
    ("calcium tablets after dinner", "रात के खाने के बाद कैल्शियम की गोली", "raat ke khane ke baad calcium ki goli"),
    ("an antihistamine at bedtime", "सोने से पहले एंटीहिस्टामिन", "sone se pehle antihistamine"),
    ("ORS whenever I feel weak", "कमजोरी लगने पर ओआरएस", "kamzori lagne par ORS"),
    ("a nasal spray in the morning", "सुबह नाक की स्प्रे", "subah naak ki spray"),
    ("two tablets of the same medicine together", "एक ही दवा की दो गोलियां साथ", "ek hi dawa ki do goliyan saath"),
]

ALLERGY_SLOTS = [
    ("penicillin", "पेनिसिलिन", "penicillin"),
    ("sulfa drugs", "सल्फा दवाइयां", "sulfa davaiyan"),
    ("peanuts", "मूंगफली", "moongphali"),
    ("dust and pollen", "धूल और पराग", "dhool aur parag"),
    ("seafood", "समुद्री भोजन", "samudri bhojan"),
    ("aspirin", "एस्पिरिन", "aspirin"),
    ("animal fur", "जानवरों के बाल", "janwaron ke baal"),
    ("latex", "लेटेक्स", "latex"),
    ("milk and dairy", "दूध और डेयरी", "doodh aur dairy"),
    ("iodine contrast dye", "आयोडीन कंट्रास्ट डाई", "iodine contrast dye"),
    ("bee stings", "मधुमक्खी के काटने", "madhumakkhi ke kaatne"),
    ("a specific antibiotic I cannot recall the name of", "एक एंटीबायोटिक जिसका नाम याद नहीं", "ek antibiotic jiska naam yaad nahi"),
    ("wheat flour", "गेहूं का आटा", "gehun ka aata"),
    ("cold weather", "ठंडा मौसम", "thanda mausam"),
    ("mosquito repellent", "मच्छर भगाने वाली क्रीम", "machhar bhagane wali cream"),
    ("soybean products", "सोया उत्पाद", "soya utpad"),
    ("a cough syrup I tried last year", "पिछले साल ली एक कफ सिरप", "pichhle saal li ek cough syrup"),
]

HISTORY_SLOTS = [
    ("asthma", "दमा", "dama"),
    ("type 2 diabetes", "टाइप 2 डायबिटीज", "type 2 diabetes"),
    ("high blood pressure", "उच्च रक्तचाप", "high blood pressure"),
    ("a heart attack two years ago", "दो साल पहले दिल का दौरा", "do saal pehle dil ka daura"),
    ("tuberculosis treated in 2019", "2019 में इलाज हुई टीबी", "2019 mein ilaaj hui TB"),
    ("a thyroid problem", "थायरॉइड की समस्या", "thyroid ki samasya"),
    ("kidney stones", "गुर्दे की पथरी", "gurde ki pathri"),
    ("an appendectomy", "अपेंडिक्स का ऑपरेशन", "appendix ka operation"),
    ("migraine", "माइग्रेन", "migraine"),
    ("anemia during pregnancy", "गर्भावस्था में खून की कमी", "garbhavastha mein khoon ki kami"),
    ("a family history of stroke", "परिवार में लकवे का इतिहास", "parivar mein lakwe ka itihas"),
    ("childhood chickenpox", "बचपन में चेचक", "bachpan mein chechak"),
    ("two caesarean deliveries", "दो सिजेरियन डिलीवरी", "do caesarean delivery"),
    ("depression treated with counselling", "काउंसलिंग से इलाज हुआ अवसाद", "counselling se ilaaj hua avsad"),
    ("chronic kidney disease stage two", "गुर्दे की पुरानी बीमारी चरण दो", "gurde ki purani bimari stage do"),
    ("a fracture in my wrist last year", "पिछले साल कलाई की हड्डी टूटी थी", "pichhle saal kalai ki haddi tooti thi"),
    ("typhoid as a teenager", "किशोरावस्था में टाइफाइड", "kishoravastha mein typhoid"),
    ("a thyroidectomy", "थायरॉइड का ऑपरेशन", "thyroid ka operation"),
    ("glaucoma in my right eye", "दाईं आंख में काला मोतिया", "daayin aankh mein kala motiya"),
    ("a family history of breast cancer", "परिवार में स्तन कैंसर का इतिहास", "parivar mein breast cancer ka itihas"),
]

OTHER_SLOTS = [
    ("my village is two hours from the nearest clinic", "मेरा गांव नजदीकी क्लिनिक से दो घंटे दूर है", "mera gaon najdiki clinic se do ghante door hai"),
    ("I live with my parents and two children", "मैं अपने माता-पिता और दो बच्चों के साथ रहती हूं", "main apne mata pita aur do bachon ke saath rehti hoon"),
    ("I work night shifts at a factory", "मैं कारखाने में नाइट शिफ्ट करता हूं", "main karkhane mein night shift karta hoon"),
    ("I do not have insurance", "मेरे पास बीमा नहीं है", "mere paas bima nahi hai"),
    ("my son can translate for me", "मेरा बेटा मेरे लिए अनुवाद कर सकता है", "mera beta mere liye translate kar sakta hai"),
    ("I want a video call because travel is hard", "यात्रा कठिन है इसलिए वीडियो कॉल चाहिए", "yatra kathin hai isliye video call chahiye"),
    ("I stopped smoking four months ago", "मैंने चार महीने पहले धूम्रपान छोड़ दिया", "maine chaar mahine pehle smoking chhod diya"),
    ("I am vegetarian", "मैं शाकाहारी हूं", "main shakahari hoon"),
    ("I need a reminder for my appointment", "मुझे अपॉइंटमेंट की याद दिलानी है", "mujhe appointment ki yaad dilani hai"),
    ("my phone battery drains quickly", "मेरे फोन की बैटरी जल्दी खत्म हो जाती है", "mere phone ki battery jaldi khatam ho jati hai"),
    ("I have three children under ten", "मेरे दस साल से छोटे तीन बच्चे हैं", "mere das saal se chote teen bachche hain"),
    ("please speak slowly, I am hard of hearing", "कृपया धीरे बोलिए, मुझे सुनने में कठिनाई है", "kripya dheere boliye, mujhe sunne mein kathinai hai"),
    ("I can only come on Sundays", "मैं सिर्फ रविवार को आ सकता हूं", "main sirf ravivar ko aa sakta hoon"),
    ("I do not drink alcohol", "मैं शराब नहीं पीता", "main sharab nahi peeta"),
    ("my husband will join the call", "मेरे पति कॉल में शामिल होंगे", "mere pati call mein shamil honge"),
    ("I am a daily wage worker", "मैं दिहाड़ी मजदूर हूं", "main dihari mazdoor hoon"),
    ("the network is weak where I live", "जहां मैं रहता हूं वहां नेटवर्क कमजोर है", "jahan main rehta hoon wahan network kamzor hai"),
    ("I am visiting from another district", "मैं दूसरे जिले से आया हूं", "main doosre zile se aaya hoon"),
    ("I exercise for thirty minutes daily", "मैं रोज तीस मिनट व्यायाम करता हूं", "main roz tees minute vyayam karta hoon"),
    ("I cannot afford the tests right now", "अभी मैं जांच का खर्च नहीं उठा सकता", "abhi main jaanch ka kharch nahi utha sakta"),
]

SYMPTOM_TEMPLATES = [
    "I have {slot}.",
    "I am getting {slot}.",
    "For me there is {slot}.",
    "Doctor, I feel {slot}.",
    "The main problem is {slot}.",
    "I am suffering from {slot}.",
    "There is {slot} bothering me.",
    "I came because of {slot}.",
]

SYMPTOM_TEMPLATES_HI = [
    "मुझे {slot} है।",
    "मेरे {slot} हो रहा है।",
    "डॉक्टर, मुझे {slot} है।",
    "मेरी मुख्य शिकायत {slot} है।",
    "मुझे {slot} की तकलीफ है।",
    "मैं {slot} से परेशान हूं।",
    "मैं {slot} की शिकायत लेकर आया हूं।",
]

SYMPTOM_TEMPLATES_HINGLISH = [
    "Mujhe {slot} hai.",
    "Mere {slot} ho raha hai.",
    "Doctor, mujhe {slot} hai.",
    "Meri main problem {slot} hai.",
    "Mujhe {slot} ki takleef hai.",
    "Main {slot} se pareshan hoon.",
    "Main {slot} ki shikayat lekar aaya hoon.",
]

DURATION_TEMPLATES = [
    "It started {slot} ago.",
    "This has been going on for {slot}.",
    "I have had this for {slot}.",
    "It has lasted {slot}.",
    "The problem appears {slot}.",
    "The complaint began {slot}.",
    "I noticed it {slot}.",
    "It has continued for {slot}.",
]

DURATION_TEMPLATES_HI = [
    "यह {slot} पहले शुरू हुआ।",
    "यह {slot} से चल रहा है।",
    "मुझे यह {slot} से है।",
    "यह {slot} तक रहा।",
    "शिकायत {slot} से शुरू हुई।",
    "मैंने यह {slot} देखा।",
    "यह {slot} तक जारी है।",
]

DURATION_TEMPLATES_HINGLISH = [
    "Ye {slot} pehle shuru hua.",
    "Ye {slot} se chal raha hai.",
    "Mujhe ye {slot} se hai.",
    "Ye {slot} tak raha.",
    "Shikayat {slot} se shuru hui.",
    "Maine ye {slot} dekha.",
    "Ye {slot} tak jaari hai.",
]

MEDICATION_TEMPLATES = [
    "I take {slot}.",
    "I am on {slot}.",
    "My doctor prescribed {slot}.",
    "I have been using {slot}.",
    "I need a refill of {slot}.",
    "I am continuing {slot}.",
    "My current medicine is {slot}.",
]

MEDICATION_TEMPLATES_HI = [
    "मैं {slot} लेता हूं।",
    "मैं {slot} पर हूं।",
    "डॉक्टर ने {slot} लिखा था।",
    "मैं {slot} इस्तेमाल कर रहा हूं।",
    "मुझे {slot} की दोबारा जरूरत है।",
    "मेरी चल रही दवा {slot} है।",
]

MEDICATION_TEMPLATES_HINGLISH = [
    "Main {slot} leta hoon.",
    "Main {slot} par hoon.",
    "Doctor ne {slot} likha tha.",
    "Main {slot} use kar raha hoon.",
    "Mujhe {slot} ki dobara zaroorat hai.",
    "Meri chal rahi dawa {slot} hai.",
]

ALLERGY_TEMPLATES = [
    "I am allergic to {slot}.",
    "I have an allergy to {slot}.",
    "I react badly to {slot}.",
    "Please avoid {slot}, I am allergic.",
    "I had a reaction to {slot} before.",
    "Do not give me {slot}, I am allergic.",
]

ALLERGY_TEMPLATES_HI = [
    "मुझे {slot} से एलर्जी है।",
    "मुझे {slot} से एलर्जी की समस्या है।",
    "मुझे {slot} से तकलीफ होती है।",
    "कृपया {slot} न दें, मुझे एलर्जी है।",
    "पहले भी {slot} से रिएक्शन हुआ था।",
]

ALLERGY_TEMPLATES_HINGLISH = [
    "Mujhe {slot} se allergy hai.",
    "Mujhe {slot} se allergy ki samasya hai.",
    "Mujhe {slot} se takleef hoti hai.",
    "Kripya {slot} na dein, mujhe allergy hai.",
    "Pehle bhi {slot} se reaction hua tha.",
]

HISTORY_TEMPLATES = [
    "I have {slot}.",
    "I had {slot}.",
    "I was diagnosed with {slot}.",
    "There is {slot} in my medical history.",
    "I was treated for {slot}.",
    "I have a history of {slot}.",
]

HISTORY_TEMPLATES_HI = [
    "मुझे {slot} है।",
    "मुझे {slot} हुआ था।",
    "मुझे {slot} का पता चला था।",
    "मेरे इतिहास में {slot} है।",
    "मेरा {slot} का इलाज हुआ था।",
]

HISTORY_TEMPLATES_HINGLISH = [
    "Mujhe {slot} hai.",
    "Mujhe {slot} hua tha.",
    "Mujhe {slot} ka pata chala tha.",
    "Mere history mein {slot} hai.",
    "Mera {slot} ka ilaaj hua tha.",
]

OTHER_TEMPLATES = [
    "{slot}.",
    "Also, {slot}.",
    "One more thing: {slot}.",
    "For context, {slot}.",
    "Just so you know, {slot}.",
]

OTHER_TEMPLATES_HI = [
    "{slot}।",
    "और, {slot}।",
    "एक बात और: {slot}।",
    "जानकारी के लिए, {slot}।",
]

OTHER_TEMPLATES_HINGLISH = [
    "{slot}.",
    "Aur, {slot}.",
    "Ek baat aur: {slot}.",
    "Jaankari ke liye, {slot}.",
]

BANK = {
    "symptom": (SYMPTOM_SLOTS, SYMPTOM_TEMPLATES, SYMPTOM_TEMPLATES_HI, SYMPTOM_TEMPLATES_HINGLISH),
    "duration": (DURATION_SLOTS, DURATION_TEMPLATES, DURATION_TEMPLATES_HI, DURATION_TEMPLATES_HINGLISH),
    "medication": (MEDICATION_SLOTS, MEDICATION_TEMPLATES, MEDICATION_TEMPLATES_HI, MEDICATION_TEMPLATES_HINGLISH),
    "allergy": (ALLERGY_SLOTS, ALLERGY_TEMPLATES, ALLERGY_TEMPLATES_HI, ALLERGY_TEMPLATES_HINGLISH),
    "medical_history": (HISTORY_SLOTS, HISTORY_TEMPLATES, HISTORY_TEMPLATES_HI, HISTORY_TEMPLATES_HINGLISH),
    "other": (OTHER_SLOTS, OTHER_TEMPLATES, OTHER_TEMPLATES_HI, OTHER_TEMPLATES_HINGLISH),
}


def scenario_id(label: str, slot_index: int, language: str) -> str:
    """Stable grouping key.

    All examples derived from the same slot in the same language belong to one scenario,
    even when they use different surface templates or a second paraphrase. The splitter
    keeps every scenario wholly inside a single split.
    """
    raw = f"{label}:{slot_index}:{language}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def slot_variants(slot: tuple[str, str, str]) -> tuple[str, str, str]:
    return slot


# --------------------------------------------------------------------------------------
# Code-switching examples
#
# Code-switched turns are generated separately and labelled `mixed` so the language-level
# evaluation can report them as their own group rather than folding them into Hindi or
# English results. Each is also assigned a code-switch scenario id per slot.
# --------------------------------------------------------------------------------------

MIXED_TEMPLATES = [
    ("I have {en} but the {hi_part} started earlier.", "symptom"),
    ("Doctor, mujhe {hi_part} hai, especially {en}.", "symptom"),
    ("Mere ko {hi_part} hai aur {en} bhi.", "symptom"),
    ("{en} is the main problem, but {hi_part} bhi ho raha hai.", "symptom"),
    ("Started {en} se pehle, now the {hi_part} is worse.", "duration"),
    ("{en} ke saath {hi_part} bhi hai.", "symptom"),
]

MIXED_PAIRS = [
    ("fever", "sir dard"),
    ("cough", "seene mein jalan"),
    ("chest pain", "saans phulna"),
    ("loose motions", "pet dard"),
    ("rash", "khujli"),
    ("dizziness", "kamar dard"),
    ("vomiting", "pet mein jalan"),
    ("sore throat", "bukhar"),
]


def mixed_examples() -> list[dict]:
    rows: list[dict] = []
    for index, (en, hi_part) in enumerate(MIXED_PAIRS):
        for template, label in MIXED_TEMPLATES:
            text = template.format(en=en, hi_part=hi_part)
            rows.append({
                "text": text,
                "label": label,
                "language": "mixed",
                "scenario_id": scenario_id(label, index, "mixed"),
                "source": "synthetic",
            })
    return rows


# --------------------------------------------------------------------------------------
# Ambiguous cases
#
# Statements that legitimately carry two documentation categories. The pipeline splits a
# turn into statements first and classifies each independently, so these are kept as a
# separate marked group (`ambiguous`) that is reported on but never used to claim
# multi-label accuracy.
# --------------------------------------------------------------------------------------

AMBIGUOUS_EXAMPLES = [
    ("Mujhe seene mein jalan hai jo do din se hai.", "symptom", "duration"),
    ("Mujhe teen hafte se sardi hai aur paracetamol leta hoon.", "duration", "medication"),
    ("I have asthma and I am allergic to dust.", "medical_history", "allergy"),
    ("Mujhe gale mein dard hai, teen din se.", "symptom", "duration"),
    ("I take insulin daily and I have type 2 diabetes.", "medication", "medical_history"),
]


def base_examples(rng: random.Random) -> list[dict]:
    rows: list[dict] = []
    for label, (slots, en_t, hi_t, hing_t) in BANK.items():
        templates = {"en": en_t, "hi": hi_t, "hinglish": hing_t}
        for slot_index, slot in enumerate(slots):
            text_en, text_hi, text_hing = slot_variants(slot)
            slot_text = {"en": text_en, "hi": text_hi, "hinglish": text_hing}
            for language in LANGUAGES:
                chosen = rng.sample(templates[language], k=min(3, len(templates[language])))
                for template in chosen:
                    rows.append({
                        "text": template.format(slot=slot_text[language]).strip(),
                        "label": label,
                        "language": language,
                        "scenario_id": scenario_id(label, slot_index, language),
                        "source": "synthetic",
                    })
    return rows


def deduplicate(rows: list[dict]) -> list[dict]:
    seen: set[tuple[str, str]] = set()
    unique: list[dict] = []
    for row in rows:
        key = (row["text"].strip().casefold(), row["label"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(row)
    return unique


def main() -> None:
    rng = random.Random(SEED)
    rows = base_examples(rng) + mixed_examples()
    rows = deduplicate(rows)
    for row in rows:
        row["text"] = " ".join(row["text"].split())

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    dataset_path = OUT_DIR / "dataset.jsonl"
    with dataset_path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    counts: dict[str, int] = {label: 0 for label in LABELS}
    by_language: dict[str, int] = {}
    by_source: dict[str, int] = {}
    scenarios: set[str] = set()
    for row in rows:
        counts[row["label"]] += 1
        by_language[row["language"]] = by_language.get(row["language"], 0) + 1
        by_source[row["source"]] = by_source.get(row["source"], 0) + 1
        scenarios.add(row["scenario_id"])

    ambiguous_path = OUT_DIR / "ambiguous_examples.jsonl"
    with ambiguous_path.open("w", encoding="utf-8") as handle:
        for text, label_a, label_b in AMBIGUOUS_EXAMPLES:
            handle.write(json.dumps({
                "text": text,
                "labels": [label_a, label_b],
                "note": "Documentation-only multi-category statement; excluded from single-label accuracy.",
            }, ensure_ascii=False) + "\n")

    manifest = {
        "dataset_version": DATASET_VERSION,
        "generator": "ml/generate_dataset.py",
        "seed": SEED,
        "provenance": "fully synthetic — authored for this project, no scraped or patient data",
        "license": "Authored for this repository; redistribute with the project.",
        "synthetic_only": True,
        "real_world_validation": False,
        "warning": "Synthetic benchmark only. Metrics measure learnability of the labelling scheme, not clinical validity.",
        "labels": LABELS,
        "row_count": len(rows),
        "scenario_count": len(scenarios),
        "counts_by_label": counts,
        "counts_by_language": by_language,
        "counts_by_source": by_source,
        "files": {
            "dataset": "ml/data/dataset.jsonl",
            "ambiguous": "ml/data/ambiguous_examples.jsonl",
        },
    }
    (OUT_DIR / "data_manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"wrote {len(rows)} synthetic statements across {len(scenarios)} scenarios")
    print(json.dumps(counts, ensure_ascii=False))
    print(json.dumps(by_language, ensure_ascii=False))


if __name__ == "__main__":
    main()
