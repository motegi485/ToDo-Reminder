import { useState } from 'react';
import { FAB } from '@/components/ui/FAB';
import { TaskFormDialog } from '@/components/task/TaskFormDialog';
import { ProjectGroup } from '@/components/project/ProjectGroup';
import { EmptyState } from '@/components/task/EmptyState';
import { SortMenu } from '@/components/task/SortMenu';
import { useProjectGroups } from '@/hooks/useProjects';
import type { Task } from '@/types';

export default function ListPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  const groups = useProjectGroups();

  const handleAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const handleEdit = (task: Task) => {
    setEditing(task);
    setFormOpen(true);
  };

  return (
    <div className="space-y-4 pb-24">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Task List</h1>
        <SortMenu />
      </header>

      {groups.length === 0 ? (
        <EmptyState />
      ) : (
        groups.map((g, index) => (
          <ProjectGroup
            key={g.name ?? '__null__'}
            name={g.name}
            tasks={g.tasks}
            onEdit={handleEdit}
            isFirstGroup={index === 0}
          />
        ))
      )}

      <FAB onClick={handleAdd} />
      <TaskFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editing={editing}
      />
    </div>
  );
}
