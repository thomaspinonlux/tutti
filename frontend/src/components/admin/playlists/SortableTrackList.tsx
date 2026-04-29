/**
 * <SortableTrackList /> — liste de tracks avec drag & drop (dnd-kit).
 * Auto-save l'ordre au backend dès qu'un drag se termine.
 */

import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Track } from '@tutti/shared';
import { Badge } from '../../ui/index.js';

interface Props {
  tracks: Track[];
  selectedTrackId?: string | null;
  onSelect?: (track: Track) => void;
  onReorder: (newOrder: Track[]) => void;
  onDelete?: (track: Track) => void;
}

export function SortableTrackList({
  tracks,
  selectedTrackId,
  onSelect,
  onReorder,
  onDelete,
}: Props): JSX.Element {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (e: DragEndEvent): void => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = tracks.findIndex((t) => t.id === active.id);
    const newIdx = tracks.findIndex((t) => t.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    onReorder(arrayMove(tracks, oldIdx, newIdx));
  };

  if (tracks.length === 0) {
    return (
      <p className="font-editorial italic text-sm text-ink-soft text-center py-12">
        — Liste vide. Utilise la recherche à droite pour ajouter des morceaux. —
      </p>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={tracks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <ul className="space-y-2">
          {tracks.map((track, idx) => (
            <SortableTrackItem
              key={track.id}
              track={track}
              index={idx}
              selected={track.id === selectedTrackId}
              onSelect={onSelect}
              onDelete={onDelete}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

interface ItemProps {
  track: Track;
  index: number;
  selected: boolean;
  onSelect?: (track: Track) => void;
  onDelete?: (track: Track) => void;
}

function SortableTrackItem({ track, index, selected, onSelect, onDelete }: ItemProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: track.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  } as const;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-3 p-2 border-2 rounded transition-colors ${
        selected ? 'border-spritz bg-spritz/10' : 'border-ink bg-white hover:bg-cream-2'
      }`}
    >
      <button
        type="button"
        aria-label="Réorganiser"
        {...attributes}
        {...listeners}
        className="font-mono text-xs uppercase tracking-wider text-ink-soft cursor-grab active:cursor-grabbing px-1 select-none"
      >
        ⋮⋮ {(index + 1).toString().padStart(2, '0')}
      </button>

      <button
        type="button"
        onClick={() => onSelect?.(track)}
        className="flex-1 min-w-0 flex items-center gap-3 text-left"
      >
        <div className="w-10 h-10 shrink-0 border border-ink rounded bg-cream-3 overflow-hidden">
          {track.cover_url ? (
            <img src={track.cover_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-ink-soft">♪</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium truncate">{track.title}</p>
          <p className="text-sm text-ink-soft truncate">
            {track.artist}
            {track.year ? ` · ${track.year}` : ''}
          </p>
        </div>
        <Badge tone="cream" tilt={index % 2 === 0 ? -1 : 1}>
          {track.provider}
        </Badge>
      </button>

      {onDelete && (
        <button
          type="button"
          onClick={() => onDelete(track)}
          className="opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 text-xs text-raspberry hover:underline"
        >
          ✕
        </button>
      )}
    </li>
  );
}
