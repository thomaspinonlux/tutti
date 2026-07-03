/**
 * /admin/library/tags — révision humaine du tagging auto des songs (ÉTAPE 4).
 * Super-admin only. Filtre par thème (index GIN), statut, recherche ; PAGINÉ.
 *
 * Réglages design actés :
 *  - table large alignée en desktop, empilée en fallback étroit.
 *  - Franco bleuté / Inter coral (teinte douce) ; N1/N2/N3 monochrome inversé.
 *  - badge de source (YouTube / Spotify) à côté du morceau (P3).
 *
 * Sauvegarde (corrige le bug « Enregistrer ne persiste rien ») :
 *  - les brouillons vivent dans le PARENT (`edits`, indexé par id) et SURVIVENT
 *    à la pagination / au changement de filtre. On peut donc éditer plusieurs
 *    pages puis tout sauver d'un coup.
 *  - « Enregistrer » (par ligne) → PATCH ; « 💾 Tout enregistrer (N) » → un seul
 *    POST /bulk-apply (transaction, découpé par 200). Toast de confirmation/erreur.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input, TitleHandwritten, Underline } from '../../components/ui/index.js';
import {
  bulkApplySongTags,
  bulkValidateSongTags,
  getSongTagsMeta,
  listSongTags,
  patchSongTags,
  type SongTagFilter,
  type SongTagPatch,
  type SongTagRow,
  type SongThemeDef,
  type TagStatus,
  type WorkKind,
} from '../../lib/adminSongTags.js';

const PAGE_SIZE = 50;
const BULK_CHUNK = 200; // ≤ max serveur (bulk-apply)
const FAMILY_LABEL: Record<string, string> = {
  decade: 'Décennies',
  genre: 'Genres',
  mood: 'Ambiances',
  work: 'Œuvres',
  format: 'Formats',
};
const WORK_KIND_LABEL: Record<WorkKind, string> = {
  film: 'Film',
  serie: 'Série',
  dessin_anime: 'Dessin animé',
  jeu_video: 'Jeu vidéo',
  comedie_musicale: 'Comédie musicale',
};

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

export function LibraryTagsPage(): JSX.Element {
  const [themes, setThemes] = useState<SongThemeDef[]>([]);
  const [rows, setRows] = useState<SongTagRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [bulkSaving, setBulkSaving] = useState(false);

  // Brouillons d'édition, indexés par id de song, ACCUMULÉS sur toutes les pages
  // visitées (survivent pagination + filtre). C'est la clé du fix : rien n'est
  // perdu tant qu'on n'a pas sauvegardé.
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

  // Filtres
  const [theme, setTheme] = useState('');
  const [status, setStatus] = useState<TagStatus>('all');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');

  // Stats globales (révisés / total)
  const [globalReviewed, setGlobalReviewed] = useState<number | null>(null);
  const [globalTotal, setGlobalTotal] = useState<number | null>(null);

  const themeLabel = useMemo(() => {
    const m = new Map<string, string>();
    themes.forEach((t) => m.set(t.slug, t.label_fr));
    return m;
  }, [themes]);

  const filter: SongTagFilter = useMemo(
    () => ({ theme: theme || undefined, status, q: q || undefined }),
    [theme, status, q],
  );

  // Debounce recherche
  useEffect(() => {
    const id = window.setTimeout(() => setQ(qInput.trim()), 350);
    return () => window.clearTimeout(id);
  }, [qInput]);

  // Reset page quand le filtre change
  useEffect(() => setPage(1), [theme, status, q]);

  useEffect(() => {
    void getSongTagsMeta()
      .then((m) => setThemes(m.themes))
      .catch((e: unknown) => setError((e as Error).message));
  }, []);

  const refreshStats = useCallback(() => {
    void listSongTags({ status: 'reviewed', limit: 1 }).then((r) => setGlobalReviewed(r.total));
    void listSongTags({ limit: 1 }).then((r) => setGlobalTotal(r.total));
  }, []);
  useEffect(refreshStats, [refreshStats]);

  const load = useCallback(() => {
    setRows(null);
    setError(null);
    let cancelled = false;
    listSongTags({ ...filter, page, limit: PAGE_SIZE })
      .then((r) => {
        if (cancelled) return;
        setRows(r.songs);
        setTotal(r.total);
        // Fusionne dans `edits` : on rafraîchit la base serveur, mais on PRÉSERVE
        // les brouillons encore modifiés (dirty) pour ne rien perdre.
        setEdits((prev) => {
          const next = { ...prev };
          for (const song of r.songs) {
            const base = toDraft(song);
            const cur = prev[song.id];
            const keep = cur && !eqDraft(cur.draft, cur.base);
            next[song.id] = { base, draft: keep ? cur.draft : base };
          }
          return next;
        });
      })
      .catch((e: unknown) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [filter, page]);
  useEffect(load, [load]);

  // Applique une song renvoyée par le serveur : maj de la ligne + base = draft
  // (le « dirty » retombe à zéro pour cette song).
  const applyServerSong = useCallback((song: SongTagRow): void => {
    setRows((rs) => (rs ? rs.map((r) => (r.id === song.id ? song : r)) : rs));
    const base = toDraft(song);
    setEdits((prev) => ({ ...prev, [song.id]: { base, draft: base } }));
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
        refreshStats();
        notify('ok', 'Enregistré ✓');
      } catch (e: unknown) {
        notify('err', `Échec : ${(e as Error).message}`);
      } finally {
        setSaving((s) => ({ ...s, [id]: false }));
      }
    },
    [applyServerSong, refreshStats, notify],
  );

  // « Tout enregistrer » : envoie tous les brouillons modifiés (toutes pages) en
  // bulk-apply, découpés par 200.
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
        songs.forEach(applyServerSong);
        saved += songs.length;
      }
      refreshStats();
      notify('ok', `${saved} morceau${saved > 1 ? 'x' : ''} enregistré${saved > 1 ? 's' : ''} ✓`);
    } catch (e: unknown) {
      notify('err', `Échec de l'enregistrement groupé : ${(e as Error).message}`);
    } finally {
      setBulkSaving(false);
    }
  }, [applyServerSong, refreshStats, notify]);

  const bulkValidate = useCallback(async (): Promise<void> => {
    if (
      !window.confirm(
        `Marquer ${total} morceaux comme révisés ?\n(accepte le tagging auto tel quel, ne modifie aucun tag)`,
      )
    )
      return;
    try {
      await bulkValidateSongTags(filter);
      refreshStats();
      load();
      notify('ok', 'Filtre marqué comme révisé ✓');
    } catch (e: unknown) {
      notify('err', (e as Error).message);
    }
  }, [filter, total, load, refreshStats, notify]);

  const dirtyCount = useMemo(
    () => Object.values(edits).filter((e) => !eqDraft(e.draft, e.base)).length,
    [edits],
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4 pb-12">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <TitleHandwritten as="h1">
            <Underline>Révision des tags</Underline>
          </TitleHandwritten>
          <p className="font-mono text-xs text-ink-soft mt-1">
            {globalReviewed !== null && globalTotal !== null
              ? `${globalReviewed} / ${globalTotal} révisés`
              : '…'}{' '}
            · édite et enregistre, ou marque en masse le tagging auto
          </p>
        </div>
        <Link to="/admin/library" className="font-mono text-xs text-spritz-deep hover:underline">
          ← Bibliothèque
        </Link>
      </header>

      {/* Barre de filtres */}
      <div className="flex flex-wrap gap-2 items-center bg-cream-2 rounded-lg p-3 border-2 border-ink/10">
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          className="border-2 border-ink/20 rounded px-2 py-1.5 text-sm bg-white"
          aria-label="Filtrer par thème"
        >
          <option value="">Tous les thèmes</option>
          {(['decade', 'genre', 'mood', 'work', 'format'] as const).map((fam) => (
            <optgroup key={fam} label={FAMILY_LABEL[fam]}>
              {themes
                .filter((t) => t.family === fam)
                .map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.label_fr}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as TagStatus)}
          className="border-2 border-ink/20 rounded px-2 py-1.5 text-sm bg-white"
          aria-label="Filtrer par statut"
        >
          <option value="all">Tous</option>
          <option value="unreviewed">À réviser</option>
          <option value="reviewed">Révisés</option>
        </select>
        <Input
          type="search"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="Titre / artiste…"
          className="!text-sm flex-1 min-w-[140px]"
          aria-label="Recherche"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void bulkValidate()}
          disabled={total === 0 || rows === null}
        >
          ✓ Marquer {total} comme révisés
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-raspberry text-sm font-medium">
          {error}
        </p>
      )}

      {/* En-tête colonnes (desktop) */}
      <div className="hidden lg:grid grid-cols-[minmax(200px,2.2fr)_150px_120px_minmax(180px,2fr)_minmax(170px,1.6fr)_120px] gap-3 px-3 font-mono text-[11px] uppercase tracking-wider text-ink-soft">
        <span>Morceau</span>
        <span>Langue</span>
        <span>Niveau</span>
        <span>Thèmes</span>
        <span>Œuvre</span>
        <span className="text-right">Statut</span>
      </div>

      {rows === null && <p className="font-mono text-ink-soft text-sm px-3">Chargement…</p>}
      {rows !== null && rows.length === 0 && (
        <p className="font-mono text-ink-soft text-sm px-3">Aucun morceau pour ce filtre.</p>
      )}

      <div className="space-y-2">
        {rows?.map((r) => {
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

      {/* Barre « Tout enregistrer » sticky — visible dès qu'il y a des brouillons
          non sauvegardés (toutes pages confondues). C'est le fix principal. */}
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
      className={`bg-white border-2 border-ink/10 rounded-lg px-3 py-2.5 lg:grid lg:grid-cols-[minmax(200px,2.2fr)_150px_120px_minmax(180px,2fr)_minmax(170px,1.6fr)_120px] lg:gap-3 lg:items-center flex flex-col gap-2.5 border-l-4 ${
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
