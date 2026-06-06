/**
 * aliasGeneration.ts — feat/ai-aliases-voice-matching
 *
 * Génère des alias de prononciation pour un morceau (titre + artiste) via
 * Claude Haiku 4.5. Cible : améliorer le matching vocal en cascade (L1/L2/L3)
 * pour les morceaux où Deepgram retourne des transcriptions phonétiques
 * françaises de titres anglo-saxons que le fuzzy matching strict rate.
 *
 * Exemples :
 *   - "Cheap Thrills" (Sia) — Deepgram FR transcrit "tchip trim"
 *     → alias "tchip trim" → match OK
 *   - "Hung Up" (Madonna) — Deepgram FR transcrit "hungap"
 *     → alias "hungap" → match OK
 *
 * Modèle : Claude Haiku 4.5 (claude-haiku-4-5-20251001) — latence ~1-2s,
 * coût ~$0.80/1M input tokens + $4/1M output tokens. Pour ~1000 tracks à
 * ~350 tokens chacune (200 input + 150 output), coût total ≈ 0.50€.
 *
 * Prompt caching : pas activé V1 (chaque track a un prompt unique).
 *
 * Sécurité : retourne [] si l'API key manque, si la réponse n'est pas du
 * JSON parsable, ou si Anthropic throw. Le caller décide quoi faire du
 * tableau vide (ne pas écraser les aliases existants notamment).
 */

import Anthropic from '@anthropic-ai/sdk';

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 500;

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
}

/**
 * Génère 8-12 aliases pour un track via Claude Haiku 4.5.
 *
 * @param title  Titre canonique du track
 * @param artist Nom canonique de l'artiste
 * @param locale 'fr' | 'en' — biais la génération vers la langue de l'utilisateur
 *               (FR = inclut plus de variations phonétiques françaises pour
 *               les titres anglais)
 */
export async function generateAliases(
  title: string,
  artist: string,
  locale?: 'fr' | 'en',
): Promise<AliasGenerationResult> {
  const t0 = Date.now();
  const c = getClient();
  if (!c) {
    return {
      aliases: [],
      latency_ms: 0,
      usage: null,
      error: 'ANTHROPIC_API_KEY_MISSING',
    };
  }

  const prompt = buildPrompt(title, artist, locale);
  console.info(
    `[Aliases] Generating | title="${title}" | artist="${artist}" | locale=${locale ?? 'auto'} | model=${ANTHROPIC_MODEL}`,
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
      `[Aliases] Generated ${aliases.length} aliases for "${title}" | latency=${latency_ms}ms | tokens=${response.usage.input_tokens}+${response.usage.output_tokens}`,
    );

    return {
      aliases,
      latency_ms,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
      error: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Aliases] Generation failed for "${title}" | error=${msg}`);
    return {
      aliases: [],
      latency_ms: Date.now() - t0,
      usage: null,
      error: msg,
    };
  }
}

/**
 * Prompt explicite + structuré pour Claude Haiku — privilégie une réponse
 * JSON pur sans préambule. Few-shot avec un exemple concret pour le format.
 */
function buildPrompt(title: string, artist: string, locale?: 'fr' | 'en'): string {
  const langContext =
    locale === 'en'
      ? 'Players are mostly English-speaking — include common English mispronunciations.'
      : 'Joueurs francophones — inclus prononciations phonétiques françaises courantes pour les titres anglais.';

  return `Tu es expert en reconnaissance vocale française pour un jeu de blind test.

Génère 8 à 12 aliases pour ce morceau, qu'un joueur est susceptible de prononcer.

Track: "${title}"
Artist: ${artist}
${langContext}

Inclus :
- Le titre original (normalisé : minuscules, sans ponctuation)
- Variations phonétiques courantes
- Sans articles (the, le, la, les)
- Avec l'artiste seul / avec titre + artiste / sans artiste
- Surnoms ou termes courants associés
- Erreurs de prononciation typiques

Format : JSON array de strings uniquement, sans préambule, sans markdown.

Exemple pour "Cheap Thrills" par Sia :
["cheap thrills", "chip thrills", "tchip trim", "chip trim", "sia", "sia cheap thrills", "sia cheap", "tchip thrille", "shipthrille", "siah"]

Maintenant pour "${title}" par ${artist}, génère le JSON :`;
}

/**
 * Parse la réponse Claude en array d'aliases. Tolère :
 *   - Préambule type "Voici les aliases : "
 *   - Markdown code fence ```json … ```
 *   - Quotes typographiques (smart quotes)
 *   - Items dupliqués (deduped)
 *   - Items vides ou trop courts (< 2 chars) — filtrés
 *
 * Renvoie [] si parse fail (caller décide de fallback ou retry).
 */
function parseAliasesJson(text: string): string[] {
  if (!text) return [];
  const cleaned = text
    .trim()
    .replace(/^```json\s*\n?/i, '')
    .replace(/\n?```$/i, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
  // Sometimes Claude wraps the array in a preamble. Try to extract the first
  // [...] block.
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
 * Estimation grossière du coût (EUR) pour N tracks. Basé sur le pricing
 * Claude Haiku 4.5 public au 2026-06 : $0.80/M input, $4/M output.
 * Hypothèses : ~200 tokens input, ~150 tokens output par track.
 * USD → EUR à 0.92 (ordre de grandeur).
 */
export function estimateCostEur(trackCount: number): number {
  const usdToEur = 0.92;
  const inputCost = ((trackCount * 200) / 1_000_000) * 0.8;
  const outputCost = ((trackCount * 150) / 1_000_000) * 4;
  return Number(((inputCost + outputCost) * usdToEur).toFixed(4));
}
