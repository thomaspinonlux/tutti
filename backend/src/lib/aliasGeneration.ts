/**
 * aliasGeneration.ts — feat/ai-aliases-voice-matching + fix/aliases-quality-v2
 *
 * Génère des alias de prononciation pour un morceau (titre + artiste) OU pour
 * un artiste seul via Claude Sonnet 4.5. Cible : améliorer le matching vocal
 * en cascade (L1/L2/L3) pour les morceaux où Deepgram retourne des
 * transcriptions phonétiques françaises de titres anglo-saxons que le fuzzy
 * matching strict rate.
 *
 * Exemples :
 *   - "Cheap Thrills" (Sia) — Deepgram FR transcrit "tchip trim"
 *     → alias "tchip trim" → match OK
 *   - "Basket Case" (Green Day) — Deepgram FR transcrit "basquette queue"
 *     → alias "basquette queue" → match OK
 *
 * Modèle : Claude Sonnet 4.5 (claude-sonnet-4-5-20250929) — meilleure
 * compréhension du prompt FR + phonétique vs Haiku. Coût plus élevé mais
 * justifié par la qualité (PR #65 avec Haiku produisait souvent juste
 * ["Cheap Thrills", "cheap thrills"] — inutile).
 *
 * Pricing 2026-06 (Sonnet 4.5) : $3/M input + $15/M output. Pour 1000 tracks
 * à ~400 in + 250 out tokens chacune : ~5 USD ≈ 4.6€.
 *
 * Sécurité : retourne [] si l'API key manque, parse fail, ou Anthropic throw.
 * Si le caller détecte aliases.length < MIN_ACCEPTED, il peut retry une fois.
 */

import Anthropic from '@anthropic-ai/sdk';

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5-20250929';
const MAX_TOKENS = 800;
/**
 * Minimum accepté pour considérer la génération comme valide. Sous ce seuil
 * le caller peut décider d'un retry ou d'un flag aliases_source='partial'.
 */
export const MIN_ACCEPTED_ALIASES = 6;

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[Aliases] ANTHROPIC_API_KEY non défini — génération désactivée');
    return null;
  }
  client = new Anthropic({ apiKey });
  return client;
}

export interface AliasGenerationResult {
  /** Alias générés (déjà normalisés en lowercase). Vide si échec. */
  aliases: string[];
  /** Latence end-to-end (ms) incluant la requête API. */
  latency_ms: number;
  /** Tokens input + output consommés. Null si l'API n'a pas répondu. */
  usage: { input_tokens: number; output_tokens: number } | null;
  /** Erreur si l'appel a échoué — pour le logging UI. */
  error: string | null;
  /** Raw response text — useful for debug when parse returns empty. */
  raw?: string;
}

/**
 * Génère 10 aliases pour un track via Claude Sonnet 4.5.
 *
 * @param title  Titre canonique du track
 * @param artist Nom canonique de l'artiste
 * @param locale 'fr' | 'en' — bias la génération vers la langue de l'utilisateur
 */
export async function generateAliases(
  title: string,
  artist: string,
  locale?: 'fr' | 'en',
): Promise<AliasGenerationResult> {
  const t0 = Date.now();
  const c = getClient();
  if (!c) {
    return { aliases: [], latency_ms: 0, usage: null, error: 'ANTHROPIC_API_KEY_MISSING' };
  }

  const prompt = buildTrackPrompt(title, artist, locale);
  console.info(
    `[Aliases] Generating track | title="${title}" | artist="${artist}" | locale=${locale ?? 'auto'} | model=${ANTHROPIC_MODEL}`,
  );

  try {
    const response = await c.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    });

    const block = response.content[0];
    const text = block && block.type === 'text' ? block.text : '';
    const aliases = withCombinationAliases(parseAliasesJson(text), title, artist);
    const latency_ms = Date.now() - t0;

    console.info(
      `[Aliases] Generated ${aliases.length} aliases for "${title}" | latency=${latency_ms}ms | tokens=${response.usage.input_tokens}+${response.usage.output_tokens}`,
    );
    if (aliases.length < MIN_ACCEPTED_ALIASES) {
      console.warn(
        `[Aliases] LOW QUALITY: only ${aliases.length} aliases for "${title}" — raw="${text.slice(0, 300)}"`,
      );
    }

    return {
      aliases,
      latency_ms,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
      error: null,
      raw: text,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Aliases] Generation failed for "${title}" | error=${msg}`);
    return { aliases: [], latency_ms: Date.now() - t0, usage: null, error: msg };
  }
}

/**
 * fix/aliases-quality-v2-and-artists — génération aliases pour artiste seul.
 * Permet à un joueur de buzz juste "Green Day" et matcher tous les morceaux
 * de Green Day (le matching backend itère track.artist.aliases).
 */
export async function generateArtistAliases(
  name: string,
  locale?: 'fr' | 'en',
): Promise<AliasGenerationResult> {
  const t0 = Date.now();
  const c = getClient();
  if (!c) {
    return { aliases: [], latency_ms: 0, usage: null, error: 'ANTHROPIC_API_KEY_MISSING' };
  }

  const prompt = buildArtistPrompt(name, locale);
  console.info(
    `[Aliases] Generating artist | name="${name}" | locale=${locale ?? 'auto'} | model=${ANTHROPIC_MODEL}`,
  );

  try {
    const response = await c.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    });

    const block = response.content[0];
    const text = block && block.type === 'text' ? block.text : '';
    const aliases = parseAliasesJson(text);
    const latency_ms = Date.now() - t0;

    console.info(
      `[Aliases] Generated ${aliases.length} artist aliases for "${name}" | latency=${latency_ms}ms | tokens=${response.usage.input_tokens}+${response.usage.output_tokens}`,
    );

    return {
      aliases,
      latency_ms,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
      error: null,
      raw: text,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Aliases] Artist generation failed for "${name}" | error=${msg}`);
    return { aliases: [], latency_ms: Date.now() - t0, usage: null, error: msg };
  }
}

/**
 * fix/aliases-quality-v2-and-artists — prompt refondu avec 3 exemples
 * concrets cibles + structure stricte. Sonnet 4.5 suit mieux les contraintes
 * que Haiku (qui souvent ne produisait que le titre et sa version lowercase).
 */
function buildTrackPrompt(title: string, artist: string, locale?: 'fr' | 'en'): string {
  const langContext =
    locale === 'en'
      ? 'Players are mostly English-speaking — include common English mispronunciations.'
      : 'Joueurs francophones — INCLUS OBLIGATOIREMENT des prononciations phonétiques FR des titres EN (ex: "cheap thrills" → "tchip trim", "basket case" → "basquette case").';

  return `Tu es expert en reconnaissance vocale française pour un jeu de blind test musical.

Track à analyser :
- Titre : "${title}"
- Artiste : "${artist}"

Génère EXACTEMENT 10 aliases que des joueurs francophones sont susceptibles de prononcer ou que la transcription Deepgram (en mode FR) peut produire.

OBLIGATOIRE — Inclus ces catégories (10 entrées au TOTAL):
1. Le titre exact (minuscules, sans ponctuation)
2. Le titre sans articles (the, le, la, les, a, an)
3. 2-3 variations phonétiques françaises du titre (comment un Français qui ne parle pas anglais prononcerait)
4. Le nom de l'artiste seul (minuscules)
5. Une variation phonétique FR du nom de l'artiste
6. La combinaison "artiste + titre" en une seule chaîne minuscule
7. 1-2 transcriptions phonétiques typiques que Deepgram FR retournerait pour un titre EN
8. Surnoms ou raccourcis courants si applicable

${langContext}

Exemples de qualité attendue :

Pour "Cheap Thrills" par "Sia" :
["cheap thrills", "chip trill", "tchip trim", "tchip thrille", "chip thril", "sia", "siah", "sia cheap thrills", "siah cheep", "sia thrills"]

Pour "Basket Case" par "Green Day" :
["basket case", "basquette case", "basket queue", "basquette queue", "green day", "grine day", "grine dé", "green day basket case", "basquette", "cas baskette"]

Pour "Hung Up" par "Madonna" :
["hung up", "hongup", "hangap", "hanguépe", "anguéppe", "madonna", "madona", "madonna hung up", "hunga", "anguppé"]

RÈGLES STRICTES :
- Format : JSON array de 10 strings, tout en minuscules
- Pas d'articles inutiles
- Pas de doublons
- L'artiste est OBLIGATOIRE comme alias séparé
- Une phonétique FR est OBLIGATOIRE pour les titres en anglais
- Réponds UNIQUEMENT avec le JSON array, sans préambule, sans markdown

Maintenant pour "${title}" par "${artist}", génère le JSON array de 10 aliases :`;
}

/**
 * fix/aliases-quality-v2-and-artists — prompt pour aliases d'artiste seul.
 * Cible : joueur dit "Green Day" → matche TOUS les morceaux Green Day.
 */
function buildArtistPrompt(name: string, locale?: 'fr' | 'en'): string {
  const langContext =
    locale === 'en'
      ? 'Players are mostly English-speaking — include common English mispronunciations.'
      : 'Joueurs francophones — inclus variations phonétiques FR pour artistes EN.';

  return `Tu es expert en reconnaissance vocale française pour un jeu de blind test.

Génère EXACTEMENT 6 aliases pour cet artiste / groupe : "${name}"

OBLIGATOIRE — Inclus ces catégories (6 entrées au TOTAL):
1. Le nom exact (minuscules, sans ponctuation)
2. Le nom sans "the" / "les" si applicable
3. 2-3 variations phonétiques courantes (Français qui prononce un nom anglais, ou abréviation)
4. Surnom courant si applicable

${langContext}

Exemples de qualité attendue :

- "Green Day" → ["green day", "grine day", "grine dé", "greene day", "grin day", "green dé"]
- "The Killers" → ["the killers", "killers", "killeurs", "killeurze", "tique killers", "killer"]
- "Avril Lavigne" → ["avril lavigne", "avril", "lavigne", "avrille", "avril lavinieu", "ave lavigne"]
- "Stromae" → ["stromae", "stromé", "stomei", "stromaye", "stromaé", "strom"]
- "Sia" → ["sia", "siah", "syah", "sya", "siya", "céa"]

RÈGLES STRICTES :
- Format : JSON array de 6 strings minuscules
- Pas de doublons
- Réponds UNIQUEMENT avec le JSON array, sans préambule, sans markdown

Maintenant pour "${name}", génère le JSON array de 6 aliases :`;
}

/**
 * Parse la réponse Claude en array d'aliases. Tolère :
 *   - Préambule type "Voici les aliases : "
 *   - Markdown code fence ```json … ```
 *   - Quotes typographiques (smart quotes)
 *   - Items dupliqués (deduped)
 *   - Items vides ou trop courts (< 2 chars) — filtrés
 */
function parseAliasesJson(text: string): string[] {
  if (!text) return [];
  const cleaned = text
    .trim()
    .replace(/^```json\s*\n?/i, '')
    .replace(/\n?```$/i, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  const jsonStr = arrayMatch ? arrayMatch[0] : cleaned;
  try {
    const parsed: unknown = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];
    const out = new Set<string>();
    for (const item of parsed) {
      if (typeof item !== 'string') continue;
      const normalized = item.toLowerCase().trim();
      if (normalized.length < 2) continue;
      out.add(normalized);
    }
    return Array.from(out);
  } catch (err) {
    console.error(
      `[Aliases] JSON parse failed | text="${text.slice(0, 200)}" | err=${err instanceof Error ? err.message : 'unknown'}`,
    );
    return [];
  }
}

/**
 * Normalise une chaîne pour construire les alias de combinaison titre/artiste :
 *   - minuscules
 *   - contenu entre parenthèses supprimé (ex: "Bad Romance (Remix)" → "Bad Romance")
 *   - accents retirés (NFD + suppression des diacritiques)
 *   - traits d'union → espaces
 *   - toute ponctuation restante retirée (garde lettres/chiffres/espaces)
 *   - espaces multiples réduits + trim
 */
function normForCombo(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ') // contenu entre parenthèses (surtout pour le titre)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacritiques
    .replace(/-/g, ' ') // traits d'union
    .replace(/[^a-z0-9\s]/g, ' ') // ponctuation restante
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Ajoute aux alias IA les 3 combinaisons titre/artiste dans l'ordre parlé
 * naturel du français, pour tous les nouveaux titres :
 *   - "<titre> <artiste>"      → "bad romance lady gaga"
 *   - "<titre> de <artiste>"   → "bad romance de lady gaga"
 *   - "<artiste> <titre>"      → "lady gaga bad romance"
 *
 * But : un joueur qui dit le titre ET l'artiste dans une même phrase marque les
 * points des DEUX (voiceMatch matche titre et artiste sur des n-grams distincts,
 * cf. lib/voiceMatch.ts). Les alias existants ne couvraient que "artiste titre".
 *
 * Déduplication : insensible à la casse, contre les alias déjà produits (qui
 * sont déjà en minuscules via parseAliasesJson).
 */
function withCombinationAliases(aliases: string[], title: string, artist: string): string[] {
  const t = normForCombo(title);
  const a = normForCombo(artist);
  // Sans titre OU sans artiste exploitable, aucune combinaison n'a de sens.
  if (!t || !a) return aliases;

  const combos = [`${t} ${a}`, `${t} de ${a}`, `${a} ${t}`];
  const seen = new Set(aliases.map((x) => x.toLowerCase()));
  const out = [...aliases];
  for (const combo of combos) {
    if (combo.length < 2) continue;
    if (seen.has(combo)) continue;
    seen.add(combo);
    out.push(combo);
  }
  return out;
}

/**
 * Estimation grossière du coût (EUR) pour N tracks via Sonnet 4.5.
 * Pricing 2026-06 : $3/M input + $15/M output. ~400 in + 250 out par track.
 * USD → EUR à 0.92 (ordre de grandeur).
 */
export function estimateCostEur(trackCount: number): number {
  const usdToEur = 0.92;
  const inputCost = ((trackCount * 400) / 1_000_000) * 3;
  const outputCost = ((trackCount * 250) / 1_000_000) * 15;
  return Number(((inputCost + outputCost) * usdToEur).toFixed(4));
}

/** Coût artist (prompt + output plus courts). */
export function estimateArtistCostEur(artistCount: number): number {
  const usdToEur = 0.92;
  const inputCost = ((artistCount * 300) / 1_000_000) * 3;
  const outputCost = ((artistCount * 150) / 1_000_000) * 15;
  return Number(((inputCost + outputCost) * usdToEur).toFixed(4));
}
