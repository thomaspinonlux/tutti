/**
 * <SortableQuestionList /> — liste de questions réordonnable (dnd-kit).
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
import { useTranslation } from 'react-i18next';
import type { Question } from '@tutti/shared';
import { Badge } from '../../ui/index.js';

interface Props {
  questions: Question[];
  selectedId?: string | null;
  onSelect?: (q: Question) => void;
  onReorder: (newOrder: Question[]) => void;
  onDelete?: (q: Question) => void;
}

export function SortableQuestionList({
  questions,
  selectedId,
  onSelect,
  onReorder,
  onDelete,
}: Props): JSX.Element {
  const { t } = useTranslation();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (e: DragEndEvent): void => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = questions.findIndex((q) => q.id === active.id);
    const newIdx = questions.findIndex((q) => q.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    onReorder(arrayMove(questions, oldIdx, newIdx));
  };

  if (questions.length === 0) {
    return (
      <p className="font-editorial italic text-sm text-ink-soft text-center py-12">
        {t('quizz.emptyQuestions')}
      </p>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={questions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
        <ul className="space-y-2">
          {questions.map((q, idx) => (
            <SortableQuestionItem
              key={q.id}
              question={q}
              index={idx}
              selected={q.id === selectedId}
              onSelect={onSelect}
              onDelete={onDelete}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableQuestionItem({
  question,
  index,
  selected,
  onSelect,
  onDelete,
}: {
  question: Question;
  index: number;
  selected?: boolean;
  onSelect?: (q: Question) => void;
  onDelete?: (q: Question) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: question.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const typeBadgeTone =
    question.type === 'MCQ'
      ? 'spritz'
      : question.type === 'TRUE_FALSE'
        ? 'lemon'
        : question.type === 'FREE_TEXT'
          ? 'basil'
          : 'plum';

  return (
    <li ref={setNodeRef} style={style}>
      <div
        className={`flex items-center gap-2 p-3 border-2 rounded transition-colors ${
          selected ? 'bg-ink text-cream border-ink' : 'bg-cream border-ink hover:bg-cream-2'
        }`}
      >
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={t('quizz.dragHandle')}
          className="cursor-grab active:cursor-grabbing px-1 text-ink-soft"
        >
          ⋮⋮
        </button>
        <span className="font-mono text-xs w-7 text-ink-soft">#{index + 1}</span>
        <button
          type="button"
          onClick={() => onSelect?.(question)}
          className="flex-1 min-w-0 text-left"
        >
          <div className="flex items-center gap-2 mb-0.5">
            <Badge tone={typeBadgeTone} tilt={index % 2 === 0 ? -1 : 1}>
              {question.type.replace('_', ' ')}
            </Badge>
            {question.category && (
              <span className="font-mono text-[10px] text-ink-soft uppercase tracking-wider">
                {question.category}
              </span>
            )}
            <span className="font-mono text-[10px] text-ink-soft">
              {question.points}
              {t('quizz.pointsAbbr')}
            </span>
          </div>
          <p className="text-sm truncate">{question.text_lang1}</p>
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(question);
            }}
            aria-label={t('common.delete')}
            className="text-ink-soft hover:text-raspberry transition-colors px-2"
          >
            ✕
          </button>
        )}
      </div>
    </li>
  );
}
