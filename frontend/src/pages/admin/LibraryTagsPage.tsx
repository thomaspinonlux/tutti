/**
 * /admin/library/tags — révision humaine du tagging auto des songs (ÉTAPE 4).
 * Super-admin only.
 *
 * Réglages design actés :
 *  - table large alignée en desktop, empilée en fallback étroit.
 *  - Franco bleuté / Inter coral (teinte douce) ; N1/N2/N3 monochrome inversé.
 *  - badge de source (YouTube / Spotify) à côté du morceau (P3).
 *
 * Tri / filtre façon Excel (feat/tags-excel-filters) :
 *  - TOUTES les songs sont chargées côté client (par pages de 100), puis on
 *    filtre / trie / pagine en mémoire. Aucun aller-retour serveur par filtre :
 *    on obtient un vrai comportement « tableur » sur l'ensemble du catalogue.
 *  - Filtres combinables par colonne (ET entre colonnes, OU dans une colonne) :
 *    Langue, Niveau, Thèmes, Œuvre, + recherche texte (Morceau) + statut.
 *  - Tri multi-colonnes simultané : clique un en-tête pour l'ajouter au tri
 *    (asc → desc → retiré). L'ordre des clics = priorité (1, 2, 3…).
 *
 * Sauvegarde (corrige le bug « Enregistrer ne persiste rien ») :
 *  - les brouillons vivent dans le PARENT (`edits`, indexé par id) et SURVIVENT
 *    au filtre / tri / pagination. On peut donc éditer puis tout sauver d'un coup.
 *  - « Enregistrer » (par ligne) → PATCH ; « 💾 Tout enregistrer (N) » → un seul
 *    POST /bulk-apply (transaction, découpé par 200). Toast de confirmation/erreur.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input, TitleHandwritten, Underline } from '../../components/ui/index.js';
import {
  bulkApplySongTags,
  generateSongAliases,
  getSongTagsMeta,
  listSongTags,
  patchSongTags,
  type SongTagPatch,
  type SongTagRow,
  type SongThemeDef,
  type TagStatus,
  type WorkKind,
} from '../../lib/adminSongTags.js';

/** Nombre total d'alias (titre + artiste) d'une song. */
function aliasTotal(r: SongTagRow): number {
  return (r.title_aliases?.length ?? 0) + (r.artist_aliases?.length ?? 0);
}

const PAGE_SIZE = 50;
const FETCH_LIMIT = 100; // max serveur pour le chargement complet
const BULK_CHUNK = 200; // ≤ max serveur (bulk-apply)
const NONE = '__none__'; // valeur spéciale « sans … » dans les filtres

const WORK_KIND_LABEL: Record<WorkKind, string> = {
  film: 'Film',
  serie: 'Série',
  dessin_anime: 'Dessin animé',
  jeu_video: 'Jeu vidéo',
  comedie_musicale: 'Comédie musicale',
};
const WORK_ORDER: WorkKind[] = ['film', 'serie', 'dessin_anime', 'jeu_video', 'comedie_musicale'];

interface RowDraft {
  themes: string[];
  is_francophone: boolean;
  is_international: boolean;
  level: 1 | 2 | 3 | null;
  work_kind: WorkKind | null;
  work_title: string;
}

/** Brouillon d'édition (draft) + vérité serveur (base) pour calculer le « dirty ». */
interface RowEdit {
  draft: RowDraft;
  base: RowDraft;
}

function toDraft(r: SongTagRow): RowDraft {
  return {
    themes: r.themes,
    is_francophone: r.is_francophone,
    is_international: r.is_international,
    level: r.level,
    work_kind: r.work_kind,
    work_title: r.work_title ?? '',
  };
}

function draftToPatch(d: RowDraft): SongTagPatch {
  return {
    themes: d.themes,
    is_francophone: d.is_francophone,
    is_international: d.is_international,
    level: d.level,
    work_kind: d.work_kind,
    work_title: d.work_title.trim() || null,
  };
}

const themesKey = (t: string[]): string => [...t].sort().join(',');

/** Deux drafts sont-ils identiques ? (ordre des thèmes indifférent). */
function eqDraft(a: RowDraft, b: RowDraft): boolean {
  return (
    a.is_francophone === b.is_francophone &&
    a.is_international === b.is_international &&
    a.level === b.level &&
    a.work_kind === b.work_kind &&
    (a.work_title.trim() || '') === (b.work_title.trim() || '') &&
    themesKey(a.themes) === themesKey(b.themes)
  );
}

// ── Tri / filtre façon tableur ──────────────────────────────────────────────

type LangCat = 'franco' | 'inter' | 'both' | 'none';
type LevelCat = 'none' | '1' | '2' | '3';
type SortKey = 'title' | 'lang' | 'level' | 'themes' | 'work' | 'aliases' | 'status';
interface SortRule {
  key: SortKey;
  dir: 'asc' | 'desc';
}

const SORT_LABEL: Record<SortKey, string> = {
  title: 'Morceau',
  lang: 'Langue',
  level: 'Niveau',
  themes: 'Thèmes',
  work: 'Œuvre',
  aliases: 'Alias',
  status: 'Statut',
};

function langCat(r: SongTagRow): LangCat {
  if (r.is_francophone && r.is_international) return 'both';
  if (r.is_francophone) return 'franco';
  if (r.is_international) return 'inter';
  return 'none';
}
const LANG_RANK: Record<LangCat, number> = { none: 0, franco: 1, inter: 2, both: 3 };

function workRank(r: SongTagRow): number {
  return r.work_kind ? WORK_ORDER.indexOf(r.work_kind) + 1 : 0;
}

/** Compare deux songs sur un critère (valeurs serveur, stables pendant l'édition). */
function cmpBy(a: SongTagRow, b: SongTagRow, key: SortKey): number {
  switch (key) {
    case 'title':
      return a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' });
    case 'lang':
      return LANG_RANK[langCat(a)] - LANG_RANK[langCat(b)];
    case 'level':
      return (a.level ?? 0) - (b.level ?? 0);
    case 'themes':
      return a.themes.length - b.themes.length;
    case 'work':
      return (
        workRank(a) - workRank(b) ||
        (a.work_title ?? '').localeCompare(b.work_title ?? '', 'fr', { sensitivity: 'base' })
      );
    case 'aliases':
      return aliasTotal(a) - aliasTotal(b);
    case 'status':
      return Number(a.tags_reviewed) - Number(b.tags_reviewed);
  }
}

function multiCmp(a: SongTagRow, b: SongTagRow, sorts: SortRule[]): number {
  for (const s of sorts) {
    const base = cmpBy(a, b, s.key);
    if (base !== 0) return s.dir === 'asc' ? base : -base;
  }
  return 0;
}

function toggleInSet<T>(prev: Set<T>, v: T): Set<T> {
  const next = new Set(prev);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

export function LibraryTagsPage(): JSX.Element {
  const [themes, setThemes] = useState<SongThemeDef[]>([]);
  // TOUTES les songs, chargées une fois côté client.
  const [allRows, setAllRows] = useState<SongTagRow[] | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [bulkSaving, setBulkSaving] = useState(false);

  // Brouillons d'édition, indexés par id de song, préservés à travers filtre /
  // tri / pagination. Rien n'est perdu tant qu'on n'a pas sauvegardé.
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const editsRef = useRef(edits);
  useEffect(() => {
    editsRef.current = edits;
  }, [edits]);

  // Toast de retour (Enregistré ✓ / erreur), auto-effacé.
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  const notify = useCallback((kind: 'ok' | 'err', msg: string): void => {
    setNotice({ kind, msg });
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3200);
  }, []);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  // Filtres (tous côté client)
  const [status, setStatus] = useState<TagStatus>('all');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [langSel, setLangSel] = useState<Set<LangCat>>(new Set());
  const [levelSel, setLevelSel] = useState<Set<LevelCat>>(new Set());
  const [themeSel, setThemeSel] = useState<Set<string>>(new Set());
  const [workSel, setWorkSel] = useState<Set<string>>(new Set());
  const [aliasSel, setAliasSel] = useState<Set<'with' | 'without'>>(new Set());

  // Génération d'alias IA (bouton) : progression sur le sous-ensemble filtré.
  const [genRunning, setGenRunning] = useState(false);
  const [genProgress, setGenProgress] = useState<{ done: number; total: number } | null>(null);

  // Tri multi-colonnes (ordre = priorité).
  const [sorts, setSorts] = useState<SortRule[]>([]);

  const themeLabel = useMemo(() => {
    const m = new Map<string, string>();
    themes.forEach((t) => m.set(t.slug, t.label_fr));
    return m;
  }, [themes]);

  // Debounce recherche
  useEffect(() => {
    const id = window.setTimeout(() => setQ(qInput.trim().toLowerCase()), 300);
    return () => window.clearTimeout(id);
  }, [qInput]);

  // Reset page quand filtre / tri change
  useEffect(() => {
    setPage(1);
  }, [status, q, langSel, levelSel, themeSel, workSel, aliasSel, sorts]);

  useEffect(() => {
    void getSongTagsMeta()
      .then((m) => setThemes(m.themes))
      .catch((e: unknown) => setError((e as Error).message));
  }, []);

  // Chargement complet : page 1 pour connaître le total, puis le reste en //.
  const loadAll = useCallback(() => {
    setAllRows(null);
    setError(null);
    let cancelled = false;
    void (async () => {
      try {
        const first = await listSongTags({ page: 1, limit: FETCH_LIMIT });
        if (cancelled) return;
        const pages = Math.max(1, Math.ceil(first.total / FETCH_LIMIT));
        let acc = first.songs;
        if (pages > 1) {
          const rest = await Promise.all(
            Array.from({ length: pages - 1 }, (_, i) =>
              listSongTags({ page: i + 2, limit: FETCH_LIMIT }),
            ),
          );
          if (cancelled) return;
          for (const r of rest) acc = acc.concat(r.songs);
        }
        setAllRows(acc);
        setEdits((prev) => {
          const next = { ...prev };
          for (const song of acc) {
            const base = toDraft(song);
            const cur = prev[song.id];
            const keep = cur && !eqDraft(cur.draft, cur.base);
            next[song.id] = { base, draft: keep ? cur.draft : base };
          }
          return next;
        });
      } catch (e: unknown) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(loadAll, [loadAll]);

  // Stats globales dérivées (plus d'appel réseau).
  const globalTotal = allRows?.length ?? null;
  const globalReviewed = allRows ? allRows.filter((r) => r.tags_reviewed).length : null;

  // Applique une song renvoyée par le serveur : maj de la ligne + base = draft.
  const applyServerSong = useCallback((song: SongTagRow): void => {
    setAllRows((rs) => (rs ? rs.map((r) => (r.id === song.id ? song : r)) : rs));
    const base = toDraft(song);
    setEdits((prev) => ({ ...prev, [song.id]: { base, draft: base } }));
  }, []);

  // Applique un lot de songs en un seul re-render (utilisé par les bulk).
  const applyServerSongs = useCallback((songs: SongTagRow[]): void => {
    if (songs.length === 0) return;
    const byId = new Map(songs.map((s) => [s.id, s]));
    setAllRows((rs) => (rs ? rs.map((r) => byId.get(r.id) ?? r) : rs));
    setEdits((prev) => {
      const next = { ...prev };
      for (const s of songs) {
        const base = toDraft(s);
        next[s.id] = { base, draft: base };
      }
      return next;
    });
  }, []);

  // Édition d'un brouillon (contrôlé par le parent).
  const changeDraft = useCallback((id: string, updater: (d: RowDraft) => RowDraft): void => {
    setEdits((prev) => {
      const cur = prev[id];
      if (!cur) return prev;
      return { ...prev, [id]: { ...cur, draft: updater(cur.draft) } };
    });
  }, []);

  // Save d'une song (PATCH). « Enregistrer » → tags_reviewed=true.
  const save = useCallback(
    async (id: string): Promise<void> => {
      const cur = editsRef.current[id];
      if (!cur) return;
      setSaving((s) => ({ ...s, [id]: true }));
      try {
        const { song } = await patchSongTags(id, draftToPatch(cur.draft));
        applyServerSong(song);
        notify('ok', 'Enregistré ✓');
      } catch (e: unknown) {
        notify('err', `Échec : ${(e as Error).message}`);
      } finally {
        setSaving((s) => ({ ...s, [id]: false }));
      }
    },
    [applyServerSong, notify],
  );

  // ── Dérivés : filtre → tri → page ────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!allRows) return null;
    return allRows.filter((r) => {
      if (status === 'reviewed' && !r.tags_reviewed) return false;
      if (status === 'unreviewed' && r.tags_reviewed) return false;
      if (q && !`${r.title} ${r.artist}`.toLowerCase().includes(q)) return false;
      if (langSel.size && !langSel.has(langCat(r))) return false;
      if (levelSel.size) {
        const lc: LevelCat = r.level === null ? 'none' : (String(r.level) as LevelCat);
        if (!levelSel.has(lc)) return false;
      }
      if (themeSel.size) {
        const matchNone = themeSel.has(NONE) && r.themes.length === 0;
        const matchAny = r.themes.some((s) => themeSel.has(s));
        if (!matchNone && !matchAny) return false;
      }
      if (workSel.size) {
        const matchNone = workSel.has(NONE) && !r.work_kind;
        const matchKind = r.work_kind ? workSel.has(r.work_kind) : false;
        if (!matchNone && !matchKind) return false;
      }
      if (aliasSel.size) {
        const has = aliasTotal(r) > 0;
        const matchWith = aliasSel.has('with') && has;
        const matchWithout = aliasSel.has('without') && !has;
        if (!matchWith && !matchWithout) return false;
      }
      return true;
    });
  }, [allRows, status, q, langSel, levelSel, themeSel, workSel, aliasSel]);

  const sorted = useMemo(() => {
    if (!filtered) return null;
    if (sorts.length === 0) return filtered;
    return [...filtered].sort(
      (a, b) =>
        multiCmp(a, b, sorts) || a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }),
    );
  }, [filtered, sorts]);

  const total = sorted?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageRows = useMemo(
    () => (sorted ? sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : null),
    [sorted, page],
  );

  // « Tout enregistrer » : envoie tous les brouillons modifiés en bulk-apply.
  const saveAll = useCallback(async (): Promise<void> => {
    const dirty = Object.entries(editsRef.current)
      .filter(([, e]) => !eqDraft(e.draft, e.base))
      .map(([id, e]) => ({ id, ...draftToPatch(e.draft) }));
    if (dirty.length === 0) return;
    setBulkSaving(true);
    try {
      let saved = 0;
      for (let i = 0; i < dirty.length; i += BULK_CHUNK) {
        const { songs } = await bulkApplySongTags(dirty.slice(i, i + BULK_CHUNK));
        applyServerSongs(songs);
        saved += songs.length;
      }
      notify('ok', `${saved} morceau${saved > 1 ? 'x' : ''} enregistré${saved > 1 ? 's' : ''} ✓`);
    } catch (e: unknown) {
      notify('err', `Échec de l'enregistrement groupé : ${(e as Error).message}`);
    } finally {
      setBulkSaving(false);
    }
  }, [applyServerSongs, notify]);

  // Marque le sous-ensemble filtré comme révisé (enregistre les tags affichés).
  const markFilteredReviewed = useCallback(async (): Promise<void> => {
    const list = sorted ?? [];
    if (list.length === 0) return;
    if (
      !window.confirm(
        `Marquer ${list.length} morceau${list.length > 1 ? 'x' : ''} filtré${
          list.length > 1 ? 's' : ''
        } comme révisé${list.length > 1 ? 's' : ''} ?\n(enregistre les tags affichés tels quels)`,
      )
    )
      return;
    const items = list.map((r) => {
      const d = editsRef.current[r.id]?.draft ?? toDraft(r);
      return { id: r.id, ...draftToPatch(d) };
    });
    setBulkSaving(true);
    try {
      let saved = 0;
      for (let i = 0; i < items.length; i += BULK_CHUNK) {
        const { songs } = await bulkApplySongTags(items.slice(i, i + BULK_CHUNK));
        applyServerSongs(songs);
        saved += songs.length;
      }
      notify('ok', `${saved} marqué${saved > 1 ? 's' : ''} révisé${saved > 1 ? 's' : ''} ✓`);
    } catch (e: unknown) {
      notify('err', (e as Error).message);
    } finally {
      setBulkSaving(false);
    }
  }, [sorted, applyServerSongs, notify]);

  const dirtyCount = useMemo(
    () => Object.values(edits).filter((e) => !eqDraft(e.draft, e.base)).length,
    [edits],
  );

  // Génère/étend les alias IA sur le sous-ensemble filtré, par lots de 20.
  const GEN_CHUNK = 20;
  const generateAliasesForFiltered = useCallback(async (): Promise<void> => {
    const list = sorted ?? [];
    if (list.length === 0) return;
    const eur = (list.length * 0.006).toFixed(2);
    if (
      !window.confirm(
        `Générer / étendre les alias de ${list.length} morceau${
          list.length > 1 ? 'x' : ''
        } filtré${list.length > 1 ? 's' : ''} via l'IA ?\n` +
          `Coût estimé ≈ ${eur} €. Les alias existants sont conservés (complétés, pas écrasés).`,
      )
    )
      return;
    setGenRunning(true);
    setGenProgress({ done: 0, total: list.length });
    let updated = 0;
    try {
      for (let i = 0; i < list.length; i += GEN_CHUNK) {
        const ids = list.slice(i, i + GEN_CHUNK).map((r) => r.id);
        const res = await generateSongAliases(ids);
        applyServerSongs(res.songs);
        updated += res.updated;
        setGenProgress({ done: Math.min(i + GEN_CHUNK, list.length), total: list.length });
      }
      notify('ok', `Alias générés pour ${updated} morceau${updated > 1 ? 'x' : ''} ✓`);
    } catch (e: unknown) {
      notify('err', `Génération alias : ${(e as Error).message}`);
    } finally {
      setGenRunning(false);
      setGenProgress(null);
    }
  }, [sorted, applyServerSongs, notify]);

  // Toggle 3 états d'un tri : absent → asc → desc → retiré. L'ordre d'ajout = priorité.
  const toggleSort = useCallback((key: SortKey): void => {
    setSorts((prev) => {
      const idx = prev.findIndex((s) => s.key === key);
      const cur = prev[idx];
      if (idx === -1 || !cur) return [...prev, { key, dir: 'asc' }];
      if (cur.dir === 'asc') {
        const next = [...prev];
        next[idx] = { key, dir: 'desc' };
        return next;
      }
      return prev.filter((s) => s.key !== key);
    });
  }, []);

  const filtersActive =
    !!q ||
    status !== 'all' ||
    langSel.size > 0 ||
    levelSel.size > 0 ||
    themeSel.size > 0 ||
    workSel.size > 0 ||
    aliasSel.size > 0;

  const resetAll = (): void => {
    setQInput('');
    setStatus('all');
    setLangSel(new Set());
    setLevelSel(new Set());
    setThemeSel(new Set());
    setWorkSel(new Set());
    setAliasSel(new Set());
    setSorts([]);
  };

  const themeOptions = useMemo(
    () => [
      { value: NONE, label: 'Sans thème' },
      ...themes.map((t) => ({ value: t.slug, label: t.label_fr })),
    ],
    [themes],
  );

  return (
    <div className="space-y-4 pb-12">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <TitleHandwritten as="h1">
            <Underline>Chansons &amp; paramètres</Underline>
          </TitleHandwritten>
          <p className="font-mono text-xs text-ink-soft mt-1">
            {globalReviewed !== null && globalTotal !== null
              ? `${globalReviewed} / ${globalTotal} révisés`
              : '…'}{' '}
            · tags, langue, niveau, thèmes, œuvre &amp; alias — filtre, trie, édite
          </p>
        </div>
        <Link to="/admin/library" className="font-mono text-xs text-spritz-deep hover:underline">
          ← Bibliothèque
        </Link>
      </header>

      {/* Barre de filtres façon tableur */}
      <div className="bg-cream-2 rounded-lg p-3 border-2 border-ink/10 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <Input
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Morceau : titre / artiste…"
            className="!text-sm flex-1 min-w-[160px]"
            aria-label="Recherche morceau"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as TagStatus)}
            className="border-2 border-ink/20 rounded px-2 py-1.5 text-sm bg-white"
            aria-label="Filtrer par statut"
          >
            <option value="all">Tous statuts</option>
            <option value="unreviewed">À réviser</option>
            <option value="reviewed">Révisés</option>
          </select>
          {filtersActive || sorts.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={resetAll}>
              ✕ Réinitialiser
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void markFilteredReviewed()}
            disabled={total === 0 || bulkSaving}
          >
            ✓ Marquer {total} comme révisés
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void generateAliasesForFiltered()}
            disabled={total === 0 || genRunning}
            title="Génère (ou étend) les alias de prononciation via l'IA pour les morceaux filtrés"
          >
            {genRunning && genProgress
              ? `✨ Alias… ${genProgress.done}/${genProgress.total}`
              : `✨ Générer les alias (${total})`}
          </Button>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-3">
          <Facet
            label="Langue"
            options={[
              { value: 'franco', label: 'Franco' },
              { value: 'inter', label: 'Inter' },
              { value: 'both', label: 'Franco+Inter' },
              { value: 'none', label: 'Aucune' },
            ]}
            selected={langSel}
            onToggle={(v) => setLangSel((p) => toggleInSet(p, v))}
          />
          <Facet
            label="Niveau"
            options={[
              { value: 'none', label: 'Sans niveau' },
              { value: '1', label: 'N1' },
              { value: '2', label: 'N2' },
              { value: '3', label: 'N3' },
            ]}
            selected={levelSel}
            onToggle={(v) => setLevelSel((p) => toggleInSet(p, v))}
          />
          <Facet
            label="Œuvre"
            options={[
              { value: NONE, label: 'Sans œuvre' },
              ...WORK_ORDER.map((wk) => ({ value: wk, label: WORK_KIND_LABEL[wk] })),
            ]}
            selected={workSel}
            onToggle={(v) => setWorkSel((p) => toggleInSet(p, v))}
          />
          <Facet
            label="Alias"
            options={[
              { value: 'without', label: 'Sans alias' },
              { value: 'with', label: 'Avec alias' },
            ]}
            selected={aliasSel}
            onToggle={(v) => setAliasSel((p) => toggleInSet(p, v))}
          />
          <Facet
            label="Thèmes"
            options={themeOptions}
            selected={themeSel}
            onToggle={(v) => setThemeSel((p) => toggleInSet(p, v))}
            scroll
          />
        </div>

        {sorts.length > 0 && (
          <div className="flex flex-wrap gap-1.5 items-center border-t border-ink/10 pt-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-soft">
              Tri
            </span>
            {sorts.map((s, i) => (
              <button
                key={s.key}
                type="button"
                onClick={() => toggleSort(s.key)}
                className="inline-flex items-center gap-1 text-[11px] font-medium px-2 h-6 rounded-full bg-ink text-cream border-2 border-ink"
                title="Cliquer pour inverser / retirer"
              >
                <span className="opacity-70">{i + 1}.</span>
                {SORT_LABEL[s.key]}
                <span className="font-bold">{s.dir === 'asc' ? '↑' : '↓'}</span>
                <span className="opacity-70">×</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-raspberry text-sm font-medium">
          {error}
        </p>
      )}

      {/* En-tête colonnes (desktop) — cliquable pour trier */}
      <div className="hidden lg:grid grid-cols-[minmax(190px,2fr)_140px_112px_minmax(160px,1.8fr)_minmax(150px,1.4fr)_116px_120px] gap-3 px-3 font-mono text-[11px] uppercase tracking-wider text-ink-soft">
        <HeadSort label="Morceau" k="title" sorts={sorts} onToggle={toggleSort} />
        <HeadSort label="Langue" k="lang" sorts={sorts} onToggle={toggleSort} />
        <HeadSort label="Niveau" k="level" sorts={sorts} onToggle={toggleSort} />
        <HeadSort label="Thèmes" k="themes" sorts={sorts} onToggle={toggleSort} />
        <HeadSort label="Œuvre" k="work" sorts={sorts} onToggle={toggleSort} />
        <HeadSort label="Alias" k="aliases" sorts={sorts} onToggle={toggleSort} />
        <HeadSort label="Statut" k="status" sorts={sorts} onToggle={toggleSort} align="right" />
      </div>

      {allRows === null && (
        <p className="font-mono text-ink-soft text-sm px-3">Chargement du catalogue…</p>
      )}
      {allRows !== null && total === 0 && (
        <p className="font-mono text-ink-soft text-sm px-3">Aucun morceau pour ces filtres.</p>
      )}

      <div className="space-y-2">
        {pageRows?.map((r) => {
          const e = edits[r.id];
          const draft = e?.draft ?? toDraft(r);
          const dirty = e ? !eqDraft(e.draft, e.base) : false;
          return (
            <SongRowView
              key={r.id}
              row={r}
              draft={draft}
              dirty={dirty}
              saving={!!saving[r.id]}
              themes={themes}
              themeLabel={themeLabel}
              onChange={changeDraft}
              onSave={save}
            />
          );
        })}
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            ← Préc.
          </Button>
          <span className="font-mono text-xs text-ink-soft tabular-nums">
            page {page} / {totalPages} · {total} morceaux
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Suiv. →
          </Button>
        </div>
      )}

      {/* Barre « Tout enregistrer » sticky — visible dès qu'il y a des brouillons. */}
      {dirtyCount > 0 && (
        <div className="sticky bottom-3 z-20 flex justify-center pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 bg-ink text-cream rounded-full pl-4 pr-2 py-2 shadow-lg border-2 border-ink">
            <span className="font-mono text-xs">
              {dirtyCount} modification{dirtyCount > 1 ? 's' : ''} non enregistrée
              {dirtyCount > 1 ? 's' : ''}
            </span>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void saveAll()}
              disabled={bulkSaving}
            >
              {bulkSaving ? '… enregistrement' : `💾 Tout enregistrer (${dirtyCount})`}
            </Button>
          </div>
        </div>
      )}

      {/* Toast */}
      {notice && (
        <div
          role="status"
          className={`fixed bottom-5 right-5 z-30 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg border-2 ${
            notice.kind === 'ok'
              ? 'bg-basil text-white border-basil-deep'
              : 'bg-raspberry text-white border-raspberry'
          }`}
        >
          {notice.msg}
        </div>
      )}
    </div>
  );
}

// ── Facet (groupe de chips multi-sélection) ─────────────────────────────────
function Facet<T extends string>({
  label,
  options,
  selected,
  onToggle,
  scroll,
}: {
  label: string;
  options: { value: T; label: string }[];
  selected: Set<T>;
  onToggle: (v: T) => void;
  scroll?: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-soft">
        {label}
        {selected.size > 0 ? ` (${selected.size})` : ''}
      </span>
      <div
        className={`flex flex-wrap gap-1 ${
          scroll ? 'max-h-24 overflow-y-auto pr-1 max-w-[min(100%,560px)]' : ''
        }`}
      >
        {options.map((o) => {
          const on = selected.has(o.value);
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onToggle(o.value)}
              aria-pressed={on}
              className={`px-2 h-6 rounded-full text-[11px] font-medium border-2 whitespace-nowrap transition-colors ${
                on
                  ? 'bg-ink text-cream border-ink'
                  : 'bg-white text-ink-soft border-ink/25 hover:border-ink/50'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── En-tête de colonne cliquable (tri multi-colonnes) ───────────────────────
function HeadSort({
  label,
  k,
  sorts,
  onToggle,
  align,
}: {
  label: string;
  k: SortKey;
  sorts: SortRule[];
  onToggle: (k: SortKey) => void;
  align?: 'right';
}): JSX.Element {
  const idx = sorts.findIndex((s) => s.key === k);
  const active = idx !== -1;
  const dir = active ? (sorts[idx]?.dir ?? null) : null;
  const arrow = dir === 'asc' ? '↑' : dir === 'desc' ? '↓' : '';
  return (
    <button
      type="button"
      onClick={() => onToggle(k)}
      className={`inline-flex items-center gap-1 select-none cursor-pointer hover:text-ink transition-colors ${
        align === 'right' ? 'justify-end' : ''
      } ${active ? 'text-ink' : ''}`}
      aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
      title="Cliquer pour trier (asc → desc → retirer)"
    >
      <span>{label}</span>
      {active && (
        <span className="font-bold">
          {arrow}
          {sorts.length > 1 ? idx + 1 : ''}
        </span>
      )}
    </button>
  );
}

// ── Ligne (contrôlée par le parent) ────────────────────────────────────────
function SongRowView({
  row,
  draft,
  dirty,
  saving,
  themes,
  themeLabel,
  onChange,
  onSave,
}: {
  row: SongTagRow;
  draft: RowDraft;
  dirty: boolean;
  saving: boolean;
  themes: SongThemeDef[];
  themeLabel: Map<string, string>;
  onChange: (id: string, updater: (d: RowDraft) => RowDraft) => void;
  onSave: (id: string) => void;
}): JSX.Element {
  const done = row.tags_reviewed;
  const workTitleMissing = !!draft.work_kind && !draft.work_title.trim();
  const availThemes = themes.filter((t) => !draft.themes.includes(t.slug));
  const set = (updater: (d: RowDraft) => RowDraft): void => onChange(row.id, updater);

  return (
    <div
      className={`bg-white border-2 border-ink/10 rounded-lg px-3 py-2.5 lg:grid lg:grid-cols-[minmax(190px,2fr)_140px_112px_minmax(160px,1.8fr)_minmax(150px,1.4fr)_116px_120px] lg:gap-3 lg:items-center flex flex-col gap-2.5 border-l-4 ${
        done ? 'border-l-basil' : 'border-l-spritz/50'
      } ${saving ? 'opacity-70' : ''}`}
    >
      {/* Morceau + badges de source (P3) */}
      <div className="min-w-0">
        <div>
          <span className="font-medium break-words">{row.title}</span>{' '}
          <span className="text-ink-soft text-sm break-words">— {row.artist}</span>
          {row.year ? <span className="text-ink-faded text-xs"> · {row.year}</span> : null}
        </div>
        {(row.has_youtube || row.has_spotify) && (
          <div className="flex gap-1 mt-0.5">
            {row.has_youtube && (
              <span
                className="inline-flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200"
                title="youtube_id présent"
              >
                ▶ YouTube
              </span>
            )}
            {row.has_spotify && (
              <span
                className="inline-flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200"
                title="spotify_id présent"
              >
                ♪ Spotify
              </span>
            )}
          </div>
        )}
      </div>

      {/* Langue */}
      <div className="flex gap-1.5">
        <LangToggle
          active={draft.is_francophone}
          tone="franco"
          label="Franco"
          onClick={() => set((d) => ({ ...d, is_francophone: !d.is_francophone }))}
        />
        <LangToggle
          active={draft.is_international}
          tone="inter"
          label="Inter"
          onClick={() => set((d) => ({ ...d, is_international: !d.is_international }))}
        />
      </div>

      {/* Niveau */}
      <div className="inline-flex border-2 border-ink/20 rounded overflow-hidden w-fit">
        {([1, 2, 3] as const).map((n) => (
          <button
            key={n}
            onClick={() => set((d) => ({ ...d, level: d.level === n ? null : n }))}
            className={`w-9 h-7 text-xs font-medium ${n > 1 ? 'border-l-2 border-ink/20' : ''} ${
              draft.level === n
                ? 'bg-ink text-cream'
                : 'bg-transparent text-ink-soft hover:bg-ink/5'
            }`}
            aria-pressed={draft.level === n}
          >
            N{n}
          </button>
        ))}
      </div>

      {/* Thèmes */}
      <div className="flex flex-wrap gap-1.5 items-center">
        {draft.themes.map((slug) => (
          <span
            key={slug}
            className="inline-flex items-center gap-1 text-xs pl-2 pr-1 py-0.5 bg-cream-2 border border-ink/15 rounded-full"
          >
            {themeLabel.get(slug) ?? slug}
            <button
              onClick={() => set((d) => ({ ...d, themes: d.themes.filter((s) => s !== slug) }))}
              aria-label={`retirer ${slug}`}
              className="text-ink-faded hover:text-raspberry text-sm leading-none px-0.5"
            >
              ×
            </button>
          </span>
        ))}
        <select
          value=""
          onChange={(e) => {
            const s = e.target.value;
            if (s) set((d) => (d.themes.includes(s) ? d : { ...d, themes: [...d.themes, s] }));
          }}
          className="text-xs border border-dashed border-ink/30 rounded px-1 py-0.5 bg-white text-ink-soft"
          aria-label="Ajouter un thème"
        >
          <option value="">+ thème</option>
          {availThemes.map((t) => (
            <option key={t.slug} value={t.slug}>
              {t.label_fr}
            </option>
          ))}
        </select>
      </div>

      {/* Œuvre */}
      <div className="flex flex-col gap-1">
        <select
          value={draft.work_kind ?? ''}
          onChange={(e) =>
            set((d) => ({ ...d, work_kind: (e.target.value || null) as WorkKind | null }))
          }
          className="text-xs border-2 border-ink/20 rounded px-1 py-1 bg-white"
          aria-label="Type d'œuvre"
        >
          <option value="">— pas une œuvre —</option>
          {(Object.keys(WORK_KIND_LABEL) as WorkKind[]).map((wk) => (
            <option key={wk} value={wk}>
              {WORK_KIND_LABEL[wk]}
            </option>
          ))}
        </select>
        {draft.work_kind && (
          <input
            value={draft.work_title}
            onChange={(e) => set((d) => ({ ...d, work_title: e.target.value }))}
            placeholder={workTitleMissing ? 'nom de l’œuvre à saisir' : 'nom de l’œuvre'}
            className={`text-xs rounded px-2 py-1 border-2 ${
              workTitleMissing
                ? 'border-spritz bg-spritz/10 placeholder:text-spritz-deep'
                : 'border-ink/20'
            }`}
            aria-label="Nom de l'œuvre"
          />
        )}
      </div>

      {/* Alias de prononciation (lecture seule — édition via page détail playlist) */}
      <div className="flex flex-wrap gap-1 items-center">
        {aliasTotal(row) === 0 ? (
          <span className="text-[11px] font-mono text-ink-faded">sans alias</span>
        ) : (
          <>
            {(row.artist_aliases?.length ?? 0) > 0 && (
              <span
                title={`Artiste : ${(row.artist_aliases ?? []).join(', ')}`}
                className="inline-flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200"
              >
                🎤 {row.artist_aliases?.length}
              </span>
            )}
            {(row.title_aliases?.length ?? 0) > 0 && (
              <span
                title={`Titre : ${(row.title_aliases ?? []).join(', ')}`}
                className="inline-flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.5 rounded bg-orange-50 text-orange-800 border border-orange-200"
              >
                🎵 {row.title_aliases?.length}
              </span>
            )}
          </>
        )}
      </div>

      {/* Statut / Enregistrer */}
      <div className="flex items-center gap-2 lg:justify-end">
        {done && !dirty && (
          <span
            className="inline-flex items-center gap-1 text-basil-deep text-xs font-medium"
            title="déjà révisé"
          >
            ✓
          </span>
        )}
        {dirty && (
          <span className="text-spritz-deep text-[11px] font-mono" title="modifié non enregistré">
            ●
          </span>
        )}
        <Button
          variant={dirty || !done ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => onSave(row.id)}
          disabled={saving}
        >
          {saving ? '…' : 'Enregistrer'}
        </Button>
      </div>
    </div>
  );
}

function LangToggle({
  active,
  tone,
  label,
  onClick,
}: {
  active: boolean;
  tone: 'franco' | 'inter';
  label: string;
  onClick: () => void;
}): JSX.Element {
  const on =
    tone === 'franco'
      ? 'bg-sky-50 text-sky-800 border-sky-400'
      : 'bg-orange-50 text-orange-800 border-orange-400';
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`px-2.5 h-7 rounded-full text-xs font-medium border-2 ${
        active ? on : 'bg-transparent text-ink-soft border-ink/25 hover:border-ink/50'
      }`}
    >
      {label}
    </button>
  );
}
