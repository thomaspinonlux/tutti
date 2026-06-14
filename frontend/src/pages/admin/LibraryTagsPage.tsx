/**
 * /admin/library/tags — révision humaine du tagging auto des songs (ÉTAPE 4).
 * Super-admin only. Filtre par thème (index GIN), statut, recherche ; PAGINÉ.
 *
 * Réglages design actés :
 *  - table large alignée en desktop, empilée en fallback étroit.
 *  - Franco bleuté / Inter coral (teinte douce) ; N1/N2/N3 monochrome inversé.
 *  - tout save (édition OU « Valider ») → tags_reviewed=true ; rien ne repasse
 *    à false en usage normal.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input, TitleHandwritten, Underline } from '../../components/ui/index.js';
import {
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

export function LibraryTagsPage(): JSX.Element {
  const [themes, setThemes] = useState<SongThemeDef[]>([]);
  const [rows, setRows] = useState<SongTagRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<Record<string, boolean>>({});

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
      })
      .catch((e: unknown) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [filter, page]);
  useEffect(load, [load]);

  // Save partiel d'une song (optimiste). Tout save → tags_reviewed=true.
  const save = useCallback(
    async (id: string, patch: SongTagPatch, optimistic: Partial<SongTagRow>): Promise<void> => {
      setSaving((s) => ({ ...s, [id]: true }));
      setRows((rs) =>
        rs ? rs.map((r) => (r.id === id ? { ...r, ...optimistic, tags_reviewed: true } : r)) : rs,
      );
      try {
        const { song } = await patchSongTags(id, patch);
        setRows((rs) => (rs ? rs.map((r) => (r.id === id ? song : r)) : rs));
        refreshStats();
      } catch (e: unknown) {
        setError((e as Error).message);
        load(); // resync depuis la DB en cas d'échec
      } finally {
        setSaving((s) => ({ ...s, [id]: false }));
      }
    },
    [load, refreshStats],
  );

  const bulkValidate = useCallback(async (): Promise<void> => {
    if (!window.confirm(`Valider les ${total} morceaux filtrés ?\n(accepte le tagging tel quel)`))
      return;
    try {
      await bulkValidateSongTags(filter);
      refreshStats();
      load();
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }, [filter, total, load, refreshStats]);

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
            · révise à la main, ou valide en masse le tagging auto
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
          variant="secondary"
          size="sm"
          onClick={() => void bulkValidate()}
          disabled={total === 0 || rows === null}
        >
          ✓ Valider les {total} filtrés
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-raspberry text-sm font-medium">
          {error}
        </p>
      )}

      {/* En-tête colonnes (desktop) */}
      <div className="hidden lg:grid grid-cols-[minmax(200px,2.2fr)_150px_120px_minmax(180px,2fr)_minmax(170px,1.6fr)_90px] gap-3 px-3 font-mono text-[11px] uppercase tracking-wider text-ink-soft">
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
        {rows?.map((r) => (
          <SongRowView
            key={r.id}
            row={r}
            saving={!!saving[r.id]}
            themes={themes}
            themeLabel={themeLabel}
            onSave={save}
          />
        ))}
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
    </div>
  );
}

// ── Ligne ────────────────────────────────────────────────────────────────
function SongRowView({
  row,
  saving,
  themes,
  themeLabel,
  onSave,
}: {
  row: SongTagRow;
  saving: boolean;
  themes: SongThemeDef[];
  themeLabel: Map<string, string>;
  onSave: (id: string, patch: SongTagPatch, optimistic: Partial<SongTagRow>) => void;
}): JSX.Element {
  const [wtDraft, setWtDraft] = useState(row.work_title ?? '');
  useEffect(() => setWtDraft(row.work_title ?? ''), [row.work_title]);

  const done = row.tags_reviewed;
  const workTitleMissing = !!row.work_kind && !(row.work_title ?? '').trim();
  const availThemes = themes.filter((t) => !row.themes.includes(t.slug));

  const toggleLevel = (n: 1 | 2 | 3): void =>
    onSave(row.id, { level: row.level === n ? null : n }, { level: row.level === n ? null : n });
  const addTheme = (slug: string): void => {
    if (!slug || row.themes.includes(slug)) return;
    const themesNext = [...row.themes, slug];
    onSave(row.id, { themes: themesNext }, { themes: themesNext });
  };
  const removeTheme = (slug: string): void => {
    const themesNext = row.themes.filter((s) => s !== slug);
    onSave(row.id, { themes: themesNext }, { themes: themesNext });
  };

  return (
    <div
      className={`bg-white border-2 border-ink/10 rounded-lg px-3 py-2.5 lg:grid lg:grid-cols-[minmax(200px,2.2fr)_150px_120px_minmax(180px,2fr)_minmax(170px,1.6fr)_90px] lg:gap-3 lg:items-center flex flex-col gap-2.5 border-l-4 ${
        done ? 'border-l-basil' : 'border-l-spritz/50'
      } ${saving ? 'opacity-70' : ''}`}
    >
      {/* Morceau */}
      <div className="min-w-0">
        <span className="font-medium break-words">{row.title}</span>{' '}
        <span className="text-ink-soft text-sm break-words">— {row.artist}</span>
        {row.year ? <span className="text-ink-faded text-xs"> · {row.year}</span> : null}
      </div>

      {/* Langue */}
      <div className="flex gap-1.5">
        <LangToggle
          active={row.is_francophone}
          tone="franco"
          label="Franco"
          onClick={() =>
            onSave(
              row.id,
              { is_francophone: !row.is_francophone },
              { is_francophone: !row.is_francophone },
            )
          }
        />
        <LangToggle
          active={row.is_international}
          tone="inter"
          label="Inter"
          onClick={() =>
            onSave(
              row.id,
              { is_international: !row.is_international },
              { is_international: !row.is_international },
            )
          }
        />
      </div>

      {/* Niveau */}
      <div className="inline-flex border-2 border-ink/20 rounded overflow-hidden w-fit">
        {([1, 2, 3] as const).map((n) => (
          <button
            key={n}
            onClick={() => toggleLevel(n)}
            className={`w-9 h-7 text-xs font-medium ${n > 1 ? 'border-l-2 border-ink/20' : ''} ${
              row.level === n ? 'bg-ink text-cream' : 'bg-transparent text-ink-soft hover:bg-ink/5'
            }`}
            aria-pressed={row.level === n}
          >
            N{n}
          </button>
        ))}
      </div>

      {/* Thèmes */}
      <div className="flex flex-wrap gap-1.5 items-center">
        {row.themes.map((slug) => (
          <span
            key={slug}
            className="inline-flex items-center gap-1 text-xs pl-2 pr-1 py-0.5 bg-cream-2 border border-ink/15 rounded-full"
          >
            {themeLabel.get(slug) ?? slug}
            <button
              onClick={() => removeTheme(slug)}
              aria-label={`retirer ${slug}`}
              className="text-ink-faded hover:text-raspberry text-sm leading-none px-0.5"
            >
              ×
            </button>
          </span>
        ))}
        <select
          value=""
          onChange={(e) => addTheme(e.target.value)}
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
          value={row.work_kind ?? ''}
          onChange={(e) =>
            onSave(
              row.id,
              { work_kind: (e.target.value || null) as WorkKind | null },
              { work_kind: (e.target.value || null) as WorkKind | null },
            )
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
        {row.work_kind && (
          <input
            value={wtDraft}
            onChange={(e) => setWtDraft(e.target.value)}
            onBlur={() => {
              const v = wtDraft.trim();
              if (v !== (row.work_title ?? ''))
                onSave(row.id, { work_title: v || null }, { work_title: v || null });
            }}
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

      {/* Statut / Valider */}
      <div className="flex lg:justify-end">
        {done ? (
          <span className="inline-flex items-center gap-1 text-basil-deep text-xs font-medium">
            ✓ révisé
          </span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSave(row.id, {}, {})}
            disabled={saving}
            className="!text-basil-deep"
          >
            Valider
          </Button>
        )}
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
