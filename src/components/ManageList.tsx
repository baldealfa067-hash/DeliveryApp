import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ManageListProps {
  placeholder: string;
  items: { id: string; name: string }[];
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  emptyText: string;
}

const ManageList = ({ placeholder, items, onAdd, onRename, onDelete, emptyText }: ManageListProps) => {
  const { t } = useTranslation();
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  const submitAdd = () => {
    if (!newName.trim()) return;
    onAdd(newName.trim());
    setNewName("");
  };

  const submitRename = () => {
    if (!editing) return;
    if (!editing.name.trim()) return;
    onRename(editing.id, editing.name.trim());
    setEditing(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 mb-2">
        <Input
          placeholder={placeholder}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitAdd()}
        />
        <Button onClick={submitAdd} className="gap-1 shrink-0">
          <Plus className="h-4 w-4" /> {t("common.add")}
        </Button>
      </div>
      {items.map((item) => (
        <Card key={item.id}>
          <CardContent className="p-3 flex items-center justify-between gap-2">
            {editing?.id === item.id ? (
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && submitRename()}
                  className="h-10 flex-1"
                  autoFocus
                />
                <Button size="icon" variant="ghost" className="h-10 w-10 shrink-0" onClick={submitRename}>
                  <Check className="h-4 w-4 text-green-600" />
                </Button>
                <Button size="icon" variant="ghost" className="h-10 w-10 shrink-0" onClick={() => setEditing(null)}>
                  <X className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            ) : (
              <>
                <span className="font-medium text-sm">{item.name}</span>
                <div className="flex gap-1 shrink-0">
                  <Button size="icon" variant="ghost" onClick={() => setEditing({ id: item.id, name: item.name })}>
                    <Pencil className="h-4 w-4 text-muted-foreground" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => onDelete(item.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ))}
      {!items.length && <p className="text-sm text-muted-foreground text-center py-6">{emptyText}</p>}
    </div>
  );
};

export default ManageList;
