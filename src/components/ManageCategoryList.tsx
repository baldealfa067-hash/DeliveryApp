import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getCategoryName, type TranslatedCategory } from "@/lib/categoryI18n";

interface ManageCategoryListProps {
  items: TranslatedCategory[];
  onAdd: (data: { name: string; name_en: string | null; name_fr: string | null }) => void;
  onRename: (id: string, data: { name: string; name_en: string | null; name_fr: string | null }) => void;
  onDelete: (id: string) => void;
  emptyText: string;
}

const ManageCategoryList = ({ items, onAdd, onRename, onDelete, emptyText }: ManageCategoryListProps) => {
  const { t, i18n } = useTranslation();
  const [newPt, setNewPt] = useState("");
  const [newEn, setNewEn] = useState("");
  const [newFr, setNewFr] = useState("");
  const [editing, setEditing] = useState<TranslatedCategory | null>(null);
  const [editPt, setEditPt] = useState("");
  const [editEn, setEditEn] = useState("");
  const [editFr, setEditFr] = useState("");

  const startEdit = (cat: TranslatedCategory) => {
    setEditing(cat);
    setEditPt(cat.name);
    setEditEn(cat.name_en ?? "");
    setEditFr(cat.name_fr ?? "");
  };

  const submitAdd = () => {
    if (!newPt.trim()) return;
    onAdd({
      name: newPt.trim(),
      name_en: newEn.trim() || null,
      name_fr: newFr.trim() || null,
    });
    setNewPt("");
    setNewEn("");
    setNewFr("");
  };

  const submitRename = () => {
    if (!editing) return;
    if (!editPt.trim()) return;
    onRename(editing.id, {
      name: editPt.trim(),
      name_en: editEn.trim() || null,
      name_fr: editFr.trim() || null,
    });
    setEditing(null);
  };

  const lang = i18n.language;

  return (
    <div className="flex flex-col gap-3">
      {/* Add form */}
      <Card>
        <CardContent className="p-3 flex flex-col gap-2">
          <Label className="text-xs font-semibold">Nova categoria</Label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="new-pt" className="text-[11px] text-muted-foreground">PT *</Label>
              <Input
                id="new-pt"
                placeholder="PT (ex: Canalização)"
                value={newPt}
                onChange={(e) => setNewPt(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="new-en" className="text-[11px] text-muted-foreground">EN</Label>
              <Input
                id="new-en"
                placeholder="EN (ex: Plumbing)"
                value={newEn}
                onChange={(e) => setNewEn(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="new-fr" className="text-[11px] text-muted-foreground">FR</Label>
              <Input
                id="new-fr"
                placeholder="FR (ex: Plomberie)"
                value={newFr}
                onChange={(e) => setNewFr(e.target.value)}
              />
            </div>
          </div>
          <Button onClick={submitAdd} disabled={!newPt.trim()} className="gap-1 w-full sm:w-auto self-start">
            <Plus className="h-4 w-4" /> {t("common.add")}
          </Button>
          <p className="text-[11px] text-muted-foreground">PT é obrigatório. EN/FR são traduções exibidas quando o utilizador muda o idioma.</p>
        </CardContent>
      </Card>

      {/* List */}
      {items.map((item) => (
        <Card key={item.id}>
          <CardContent className="p-3">
            {editing?.id === item.id ? (
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px] text-muted-foreground">PT *</Label>
                    <Input value={editPt} onChange={(e) => setEditPt(e.target.value)} autoFocus />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px] text-muted-foreground">EN</Label>
                    <Input value={editEn} onChange={(e) => setEditEn(e.target.value)} placeholder="English" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px] text-muted-foreground">FR</Label>
                    <Input value={editFr} onChange={(e) => setEditFr(e.target.value)} placeholder="Français" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={submitRename} disabled={!editPt.trim()} className="gap-1">
                    <Check className="h-4 w-4" /> Guardar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    <X className="h-4 w-4" /> {t("common.cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm flex flex-wrap items-center gap-2">
                    <span>{getCategoryName(item, lang)}</span>
                    <span className="text-[11px] text-muted-foreground font-normal">
                      PT: {item.name} {item.name_en ? `• EN: ${item.name_en}` : "• EN: —"} {item.name_fr ? `• FR: ${item.name_fr}` : "• FR: —"}
                    </span>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="icon" variant="ghost" onClick={() => startEdit(item)}>
                    <Pencil className="h-4 w-4 text-muted-foreground" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => onDelete(item.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
      {!items.length && <p className="text-sm text-muted-foreground text-center py-6">{emptyText}</p>}
    </div>
  );
};

export default ManageCategoryList;
