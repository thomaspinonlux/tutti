-- feat/tv-carousel-polish — cover_url sur OfficialPlaylist.
-- Servi dynamiquement par GET /api/library-cover/:slug.jpg
-- (mosaïque 2x2 des 4 premières covers des tracks du pool, généré on-demand
-- + cache in-memory). Nullable : si NULL le frontend fallback texte.

ALTER TABLE "official_playlists"
  ADD COLUMN "cover_url" TEXT;
