"""Keyword classifier: company description -> (domain_group, industry, matched words).

Groups follow the Veselova sheet taxonomy used by the curated directory. The
matched keywords are returned so every value carries its evidence; no match
returns None and the caller records "not found".
"""
from __future__ import annotations

import re

# (domain_group, industry, keyword regex). First group with the most hits wins.
RULES: list[tuple[str, str, str]] = [
    ("Fintech, Payments, Banking, Trading", "Fintech",
     r"банк|bank|платеж|платёж|payment|финтех|fintech|кредит|лизинг|брокер|broker|инвестиц|страхов|"
     r"insur|микрофинанс|эквайринг|трейдинг|trading|бирж"),
    ("Crypto, Web3", "Crypto, Web3", r"крипт|crypto|блокчейн|blockchain|web3|defi|nft|токен"),
    ("iGaming, Gambling", "iGaming, Gambling", r"казино|casino|беттинг|betting|букмекер|gambling|igaming|ставк"),
    ("Gamedev", "Gamedev", r"игр[аыуое]|игров|gamedev|game studio|геймдев|видеоигр|\bgames?\b"),
    ("E-commerce, Marketplaces, D2C", "E-commerce",
     r"маркетплейс|marketplace|интернет-магазин|e-commerce|ecommerce|онлайн-шопинг|ритейл|retail|"
     r"торгов(ая|ой) сет|магазин"),
    ("Travel, Mobility, Delivery", "Travel, Mobility",
     r"доставк|delivery|логистик|logistic|такси|taxi|путешеств|travel|авиа|airline|туризм|"
     r"каршеринг|перевоз|транспорт|грузо"),
    ("FoodTech, AgriTech", "FoodTech, AgriTech", r"ресторан|restaurant|кафе|food|продукт(ы|ов) питания|агро|agri|фермер|пищев"),
    ("HealthTech, Wellness", "HealthTech",
     r"медицин|medical|клиник|clinic|здоров|health|фарм|pharma|аптек|wellness|стоматолог|лаборатор"),
    ("EdTech", "EdTech", r"образоват|обучени|education|edtech|школ|курс(ы|ов)|университет|university|learning"),
    ("Cybersecurity", "Cybersecurity", r"кибербезопас|информационн(ой|ая) безопас|cybersecurity|security|защит(а|ы) данных|антивирус"),
    ("MarTech, AdTech, SalesTech", "MarTech, AdTech",
     r"реклам|advertis|маркетинг|marketing|adtech|martech|seo|smm|digital-агентств|агентство"),
    ("HR, Recruitment, Operations", "HRTech, Recruitment", r"рекрут|recruit|подбор персонала|кадров|hr-|hrtech|staffing|аутстаф"),
    ("Media, Creator, Consumer", "Media, Consumer",
     r"медиа|media|издател|publish|контент|стриминг|streaming|кино|музык|music|новост|журнал|телеканал|радио"),
    ("Telecom, Communications", "Telecom", r"телеком|telecom|оператор связи|мобильн(ой|ая) связ|интернет-провайдер|связи"),
    ("PropTech, Real Estate, Home", "PropTech, Real Estate", r"недвижим|real estate|девелоп|застройщ|жил(ой|ые|ья) комплекс|аренд"),
    ("IndustrialTech, Manufacturing, Construction", "Industrial, Manufacturing",
     r"производств|завод|manufactur|промышлен|industrial|строител|construction|металл|нефт|газ|химич|машиностро"),
    ("ClimateTech, Energy, Sustainability", "Energy", r"энерг|energy|электросет|возобновля|solar|climate|экологи"),
    ("Hardware, Robotics, IoT", "Hardware, Robotics", r"робот|robot|iot|электрони|electronics|железо|hardware|микросхем|дрон|beспилот|беспилот"),
    ("LegalTech, RegTech, Compliance", "LegalTech", r"юрид|legal|правов|compliance|нотари"),
    ("GovTech", "GovTech", r"государствен|госуслуг|government|министерств|муниципал|бюджетн(ое|ое) учрежд"),
    ("Professional Services, Consulting", "Consulting", r"консалт|consult|аудит|audit|outsourc|аутсорс|интегратор|услуг"),
    ("AI, Data, ML", "AI, Data", r"искусственн|нейросет|\bai\b|machine learning|машинн(ое|ого) обучен|\bml\b|data science|big data"),
    ("SaaS, Software, DevTools, IT", "Software, SaaS",
     r"програм|software|saas|разработ|it-|айти|\bit\b|облач|cloud|платформ|platform|сервис|приложени|"
     r"цифров|digital|технолог"),
]
_COMPILED = [(g, i, re.compile(rx, re.I)) for g, i, rx in RULES]


def classify(text: str | None) -> tuple[str, str, list[str]] | None:
    if not text:
        return None
    best = None
    for order, (group, industry, rx) in enumerate(_COMPILED):
        hits = sorted({m.group(0).lower() for m in rx.finditer(text)})
        if not hits:
            continue
        # generic IT words lose ties to any specific vertical
        score = len(hits) - (0.5 if group.startswith("SaaS") else 0)
        if best is None or score > best[0]:
            best = (score, order, group, industry, hits)
    if not best:
        return None
    return best[2], best[3], best[4][:5]
