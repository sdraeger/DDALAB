from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence

from PySide6.QtCore import (
    Property,
    QAbstractListModel,
    QByteArray,
    QModelIndex,
    Qt,
    Signal,
    Slot,
)


class RecordListModel(QAbstractListModel):
    countChanged = Signal()

    def __init__(self, roles: Sequence[str], parent=None) -> None:
        super().__init__(parent)
        self._roles = tuple(roles)
        self._role_ids = {
            Qt.ItemDataRole.UserRole + index + 1: name
            for index, name in enumerate(self._roles)
        }
        self._rows: list[dict[str, object]] = []

    def roleNames(self) -> dict[int, QByteArray]:  # type: ignore[override]
        return {
            role_id: QByteArray(name.encode("utf-8"))
            for role_id, name in self._role_ids.items()
        }

    def rowCount(self, parent=QModelIndex()) -> int:  # type: ignore[override]
        return 0 if parent.isValid() else len(self._rows)

    def data(self, index: QModelIndex, role: int = Qt.DisplayRole):  # type: ignore[override]
        if not index.isValid() or not 0 <= index.row() < len(self._rows):
            return None
        name = self._role_ids.get(role)
        return self._rows[index.row()].get(name) if name else None

    def replace(self, rows: Iterable[Mapping[str, object]]) -> None:
        self.beginResetModel()
        self._rows = [dict(row) for row in rows]
        self.endResetModel()
        self.countChanged.emit()

    def row(self, index: int) -> dict[str, object] | None:
        return self._rows[index] if 0 <= index < len(self._rows) else None

    def update(self, index: int, **values: object) -> None:
        row = self.row(index)
        if row is None:
            return
        changed_roles = [
            role
            for role, name in self._role_ids.items()
            if name in values and row.get(name) != values[name]
        ]
        if not changed_roles:
            return
        row.update(values)
        model_index = self.index(index, 0)
        self.dataChanged.emit(model_index, model_index, changed_roles)

    @Slot(int, result="QVariantMap")
    def get(self, index: int) -> dict[str, object]:
        return dict(self.row(index) or {})

    @Property(int, notify=countChanged)
    def count(self) -> int:
        return len(self._rows)


class SelectionListModel(RecordListModel):
    selectionChanged = Signal()

    def __init__(self, roles: Sequence[str], parent=None) -> None:
        if "selected" not in roles:
            roles = (*roles, "selected")
        super().__init__(roles, parent)

    @Slot(int, bool)
    def setSelected(self, index: int, selected: bool) -> None:
        row = self.row(index)
        if row is None or bool(row.get("selected")) == selected:
            return
        row["selected"] = selected
        model_index = self.index(index, 0)
        selected_role = next(
            role for role, name in self._role_ids.items() if name == "selected"
        )
        self.dataChanged.emit(model_index, model_index, [selected_role])
        self.selectionChanged.emit()

    @Slot(bool)
    def selectAll(self, selected: bool) -> None:
        changed = False
        for row in self._rows:
            if bool(row.get("selected")) != selected:
                row["selected"] = selected
                changed = True
        if not changed or not self._rows:
            return
        selected_role = next(
            role for role, name in self._role_ids.items() if name == "selected"
        )
        self.dataChanged.emit(
            self.index(0, 0),
            self.index(len(self._rows) - 1, 0),
            [selected_role],
        )
        self.selectionChanged.emit()

    def selected_rows(self) -> list[dict[str, object]]:
        return [row for row in self._rows if bool(row.get("selected"))]
