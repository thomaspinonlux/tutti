/**
 * <BadgeManches /> — feat/compteur-manches-completes
 * Toujours visible sur la console animateur (06/11, Thomas : « je veux le
 * voir ») : manche en cours et nombre de manches jouées JUSQU'AU BOUT.
 */
import { useTranslation } from 'react-i18next';

export function BadgeManches({ lancees, completes }: { lancees: number; completes: number }): JSX.Element {
  const { t } = useTranslation();
  return (
    <span
      role="status"
      className="px-3 py-1.5 rounded-full border-2 border-hairline bg-ink text-cream text-sm font-semibold whitespace-nowrap tabular-nums"
    >
      {lancees > 0 ? t('host.eyebrowPlaying', { round: lancees }) : t('host.aucuneManche')} ·{' '}
      {t('host.manchesCompletes', { count: completes })}
    </span>
  );
}
