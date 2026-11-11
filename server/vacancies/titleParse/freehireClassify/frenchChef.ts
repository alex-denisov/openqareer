// Port of freehire internal/dict/classify french.go unchefFrench and looksFrench — the
// pre-step classify.matchCategory applies before the main table
// (MIT, Copyright (c) 2026 freehire contributors).
import { foldSpanish } from './languageFallbacks';

const LOOKS_FRENCH =
  /[éèêàçùâîôûëï]|\b[hf]\s*\/\s*[hf]\b|\b(?:d|l|qu)'\p{L}|\b(?:de|des|du|et|en|pour|au|aux|chez|avec|sur)\b|\b(?:cdi|cdd|alternance|alternant|stagiaire|apprenti|interim)\b|\p{L}[·•]\p{L}|\((?:e|ne|euse|trice|rice)\)/u;

const FRENCH_ONLY_HEAD = new RegExp(
  '\\b(?:' +
    [
      'developpeur|developpeuse|ingenieur|ingenieure|technicien|technicienne|conseiller|conseillere',
      'vendeur|vendeuse|responsable|chargee|gestionnaire|infirmier|infirmiere|preparateur|cariste',
      'magasinier|serveur|serveuse|cuisinier|comptable|secretaire|employe|ouvrier|caissier|caissiere',
      'electricien|mecanicien|commerciale|commerciaux|auxiliaire|aide-soignant|aide-soignante',
      'educateur|educatrice|animateur|animatrice|formateur|formatrice|enseignant|enseignante',
      'directeur|directrice|chauffeur|livreur|coiffeur|coiffeuse|logistique|informatique|alternance',
      'stagiaire|juriste|barbier|avocat|medecin|kinesitherapeute|plombier|soudeur|macon|couvreur',
      'menuisier|operateur|operatrice|agente|assistante|analyste|architecte|administrateur',
      'administratrice|consultante|testeur|receptionniste|negociateur|acheteur|approvisionneur',
      'projeteur|dessinateur|automaticien|logisticien|manutentionnaire|plongeur|veterinaire',
      'opticien|pharmacien|psychologue|orthophoniste|chimiste|laborantin|metallier|chaudronnier',
      'carrossier|chauffagiste|frigoriste',
    ].join('|') +
    ')\\b',
  'u',
);

const FRENCH_CHEF_OF =
  /\bchef((?:\/fe|\(fe\)|[·.]fe)?\s+(?:d['’]\s*|de\s+(?:la\s+|l['’]\s*)?|des\s+|du\s+))(\p{L}+)/gu;

const FRENCH_KITCHEN_FIELD: ReadonlySet<string> = new Set([
  'cuisine',
  'partie',
  'rang',
  'salle',
  'bar',
  'brigade',
  'cave',
  'pâtisserie',
  'patisserie',
  'réception',
  'reception',
  'plonge',
  'cuisines',
]);

const FRENCH_CFO = /\bcfo\b/gu;
const FRENCH_ELECTRICAL_WORK =
  /(?:^|[^\p{L}\p{N}_])(?:cfa|maintenance|multitechnique|[ée]lectri\p{L}*|travaux|chantier|technicien\p{L}*|[ée]tudes?|affaires|courants?|ing[ée]nieur\p{L}*|r[ée]f[ée]rent\p{L}*)(?:$|[^\p{L}\p{N}_])/u;

export function looksFrench(lower: string): boolean {
  return LOOKS_FRENCH.test(lower.replaceAll('’', "'")) || FRENCH_ONLY_HEAD.test(foldSpanish(lower));
}

/** Rewrites a French non-kitchen "chef de X" to "cheffe de X" and the electrical "CFO". */
export function unchefFrench(input: string): string {
  let lower = input.replaceAll('&#39;', "'");
  if (lower.includes('cfo') && looksFrench(lower) && FRENCH_ELECTRICAL_WORK.test(lower)) {
    lower = lower.replace(FRENCH_CFO, 'courant fort');
  }
  if (!lower.includes('chef')) return lower;
  return lower.replace(FRENCH_CHEF_OF, (match: string, glue: string, field: string) =>
    FRENCH_KITCHEN_FIELD.has(field) ? match : `cheffe${glue}${field}`,
  );
}
