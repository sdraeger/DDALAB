from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict
from pathlib import Path
from typing import Iterable, List, Optional

from ..domain.models import (
    DdaResult,
    DdaResultSummary,
    DdaVariantResult,
    IcaComponent,
    IcaResult,
    NotificationEntry,
    WaveformAnnotation,
    WorkflowActionEntry,
    WorkflowSessionEntry,
)


class StateDatabase:
    def __init__(self, db_path: Optional[Path] = None) -> None:
        self.db_path = db_path or (Path.home() / ".ddalab-qt" / "state.sqlite3")
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.db_path)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA foreign_keys=ON")
        self._init_schema()
        self._migrate_schema()

    def close(self) -> None:
        self.connection.close()

    def _init_schema(self) -> None:
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS session_state (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS open_files (
                position INTEGER PRIMARY KEY,
                path TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS annotations (
                annotation_id TEXT PRIMARY KEY,
                file_path TEXT NOT NULL,
                sort_index INTEGER NOT NULL,
                label TEXT NOT NULL,
                notes TEXT NOT NULL,
                channel_name TEXT,
                start_seconds REAL NOT NULL,
                end_seconds REAL,
                payload_json TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_annotations_file_path
            ON annotations(file_path, sort_index);

            CREATE TABLE IF NOT EXISTS dda_results (
                result_id TEXT PRIMARY KEY,
                file_path TEXT NOT NULL,
                created_at_iso TEXT NOT NULL,
                payload_json TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_dda_results_file_path
            ON dda_results(file_path, created_at_iso DESC);

            CREATE TABLE IF NOT EXISTS ica_results (
                result_id TEXT PRIMARY KEY,
                file_path TEXT NOT NULL,
                created_at_iso TEXT NOT NULL,
                payload_json TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_ica_results_file_path
            ON ica_results(file_path, created_at_iso DESC);

            CREATE TABLE IF NOT EXISTS notifications (
                notification_id TEXT PRIMARY KEY,
                created_at_iso TEXT NOT NULL,
                payload_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS workflow_actions (
                action_id TEXT PRIMARY KEY,
                created_at_iso TEXT NOT NULL,
                payload_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS workflow_sessions (
                session_id TEXT PRIMARY KEY,
                created_at_iso TEXT NOT NULL,
                payload_json TEXT NOT NULL
            );
            """
        )
        self.connection.commit()

    def _migrate_schema(self) -> None:
        self._ensure_column("dda_results", "file_name", "TEXT")
        self._ensure_column("dda_results", "engine_label", "TEXT")
        self._ensure_column(
            "dda_results",
            "variant_ids_json",
            "TEXT NOT NULL DEFAULT '[]'",
        )
        self._ensure_column(
            "dda_results",
            "is_fallback",
            "INTEGER NOT NULL DEFAULT 0",
        )

    def _ensure_column(self, table_name: str, column_name: str, definition: str) -> None:
        existing = {
            str(row["name"])
            for row in self.connection.execute(f"PRAGMA table_info({table_name})")
        }
        if column_name in existing:
            return
        self.connection.execute(
            f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}"
        )
        self.connection.commit()

    def migrate_legacy_session(self, session_path: Path) -> None:
        if not session_path.exists() or self._has_persisted_state():
            return
        try:
            payload = json.loads(session_path.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            return
        if not isinstance(payload, dict):
            return
        self.save_session_payload(
            {
                "openFiles": [
                    path
                    for path in payload.get("openFiles", [])
                    if isinstance(path, str) and path
                ],
                "activeFilePath": payload.get("activeFilePath"),
                "windowGeometry": payload.get("windowGeometry"),
                "windowMaximized": bool(payload.get("windowMaximized", False)),
            }
        )
        annotations_payload = payload.get("annotationsByFile")
        if isinstance(annotations_payload, dict):
            for file_path, annotations in annotations_payload.items():
                if not isinstance(file_path, str):
                    continue
                self.replace_annotations_for_file(
                    file_path, self._deserialize_annotations(annotations)
                )

    def _has_persisted_state(self) -> bool:
        checks = (
            "SELECT 1 FROM session_state LIMIT 1",
            "SELECT 1 FROM open_files LIMIT 1",
            "SELECT 1 FROM annotations LIMIT 1",
            "SELECT 1 FROM dda_results LIMIT 1",
            "SELECT 1 FROM ica_results LIMIT 1",
        )
        for query in checks:
            row = self.connection.execute(query).fetchone()
            if row is not None:
                return True
        return False

    def load_session_payload(self) -> dict:
        payload: dict = {}
        for row in self.connection.execute("SELECT key, value_json FROM session_state"):
            payload[row["key"]] = self._loads(row["value_json"])
        payload["openFiles"] = [
            str(row["path"])
            for row in self.connection.execute(
                "SELECT path FROM open_files ORDER BY position ASC"
            )
        ]
        return payload

    def save_session_payload(self, payload: dict) -> None:
        open_files = [
            path
            for path in payload.get("openFiles", [])
            if isinstance(path, str) and path
        ]
        session_items = {
            key: value for key, value in payload.items() if key != "openFiles"
        }
        with self.connection:
            for position, path in enumerate(open_files):
                self.connection.execute(
                    """
                    INSERT INTO open_files(position, path)
                    VALUES (?, ?)
                    ON CONFLICT(position) DO UPDATE SET path=excluded.path
                    """,
                    (position, path),
                )
            self.connection.execute(
                "DELETE FROM open_files WHERE position >= ?",
                (len(open_files),),
            )
            for key, value in session_items.items():
                self.connection.execute(
                    """
                    INSERT INTO session_state(key, value_json)
                    VALUES (?, ?)
                    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json
                    WHERE session_state.value_json <> excluded.value_json
                    """,
                    (key, self._dumps(value)),
                )

    def load_annotations_for_file(self, file_path: str) -> List[WaveformAnnotation]:
        rows = self.connection.execute(
            """
            SELECT payload_json
            FROM annotations
            WHERE file_path = ?
            ORDER BY sort_index ASC
            """,
            (file_path,),
        ).fetchall()
        return self._deserialize_annotations(
            [self._loads(row["payload_json"]) for row in rows]
        )

    def replace_annotations_for_file(
        self, file_path: str, annotations: Iterable[WaveformAnnotation]
    ) -> None:
        annotation_list = list(annotations)
        with self.connection:
            for index, annotation in enumerate(annotation_list):
                self.connection.execute(
                    """
                    INSERT INTO annotations(
                        annotation_id,
                        file_path,
                        sort_index,
                        label,
                        notes,
                        channel_name,
                        start_seconds,
                        end_seconds,
                        payload_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(annotation_id) DO UPDATE SET
                        file_path=excluded.file_path,
                        sort_index=excluded.sort_index,
                        label=excluded.label,
                        notes=excluded.notes,
                        channel_name=excluded.channel_name,
                        start_seconds=excluded.start_seconds,
                        end_seconds=excluded.end_seconds,
                        payload_json=excluded.payload_json
                    """,
                    (
                        annotation.id,
                        file_path,
                        index,
                        annotation.label,
                        annotation.notes,
                        annotation.channel_name,
                        annotation.start_seconds,
                        annotation.end_seconds,
                        self._dumps(asdict(annotation)),
                    ),
                )
            if annotation_list:
                placeholders = ",".join("?" for _ in annotation_list)
                self.connection.execute(
                    f"""
                    DELETE FROM annotations
                    WHERE file_path = ?
                    AND annotation_id NOT IN ({placeholders})
                    """,
                    [file_path, *[annotation.id for annotation in annotation_list]],
                )
            else:
                self.connection.execute(
                    "DELETE FROM annotations WHERE file_path = ?",
                    (file_path,),
                )

    def save_dda_result(self, result: DdaResult) -> None:
        variant_ids_json = self._dumps([variant.id for variant in result.variants])
        with self.connection:
            self.connection.execute(
                """
                INSERT INTO dda_results(
                    result_id,
                    file_path,
                    file_name,
                    created_at_iso,
                    engine_label,
                    variant_ids_json,
                    is_fallback,
                    payload_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(result_id) DO UPDATE SET
                    file_path=excluded.file_path,
                    file_name=excluded.file_name,
                    created_at_iso=excluded.created_at_iso,
                    engine_label=excluded.engine_label,
                    variant_ids_json=excluded.variant_ids_json,
                    is_fallback=excluded.is_fallback,
                    payload_json=excluded.payload_json
                """,
                (
                    result.id,
                    result.file_path,
                    result.file_name,
                    result.created_at_iso,
                    result.engine_label,
                    variant_ids_json,
                    int(result.is_fallback),
                    self._dumps(asdict(result)),
                ),
            )

    def load_dda_history(self, file_path: str, limit: int = 30) -> List[DdaResult]:
        rows = self.connection.execute(
            """
            SELECT payload_json
            FROM dda_results
            WHERE file_path = ?
            ORDER BY created_at_iso DESC
            LIMIT ?
            """,
            (file_path, limit),
        ).fetchall()
        return [
            self._deserialize_dda_result(self._loads(row["payload_json"]))
            for row in rows
        ]

    def load_dda_history_summaries(
        self, file_path: str, limit: int = 30
    ) -> List[DdaResultSummary]:
        rows = self.connection.execute(
            """
            SELECT
                result_id,
                file_path,
                file_name,
                created_at_iso,
                engine_label,
                variant_ids_json,
                is_fallback,
                payload_json
            FROM dda_results
            WHERE file_path = ?
            ORDER BY created_at_iso DESC
            LIMIT ?
            """,
            (file_path, limit),
        ).fetchall()
        return [self._deserialize_dda_result_summary(row) for row in rows]

    def load_dda_result_by_id(self, result_id: str) -> Optional[DdaResult]:
        row = self.connection.execute(
            """
            SELECT payload_json
            FROM dda_results
            WHERE result_id = ?
            LIMIT 1
            """,
            (result_id,),
        ).fetchone()
        if row is None:
            return None
        return self._deserialize_dda_result(self._loads(row["payload_json"]))

    def save_ica_result(self, result: IcaResult) -> None:
        with self.connection:
            self.connection.execute(
                """
                INSERT INTO ica_results(result_id, file_path, created_at_iso, payload_json)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(result_id) DO UPDATE SET
                    file_path=excluded.file_path,
                    created_at_iso=excluded.created_at_iso,
                    payload_json=excluded.payload_json
                """,
                (
                    result.id,
                    result.file_path,
                    result.created_at_iso,
                    self._dumps(asdict(result)),
                ),
            )

    def load_latest_ica_result(self, file_path: str) -> Optional[IcaResult]:
        row = self.connection.execute(
            """
            SELECT payload_json
            FROM ica_results
            WHERE file_path = ?
            ORDER BY created_at_iso DESC
            LIMIT 1
            """,
            (file_path,),
        ).fetchone()
        if row is None:
            return None
        return self._deserialize_ica_result(self._loads(row["payload_json"]))

    def load_notifications(self, limit: int = 250) -> List[NotificationEntry]:
        rows = self.connection.execute(
            """
            SELECT payload_json
            FROM notifications
            ORDER BY created_at_iso DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [
            self._deserialize_notification(self._loads(row["payload_json"]))
            for row in rows
        ]

    def replace_notifications(self, entries: Iterable[NotificationEntry]) -> None:
        notification_list = list(entries)
        self._replace_timestamped_payload_rows(
            "notifications",
            "notification_id",
            ((entry.id, entry.created_at_iso, self._dumps(asdict(entry))) for entry in notification_list),
        )

    def load_workflow_actions(self) -> List[WorkflowActionEntry]:
        rows = self.connection.execute(
            """
            SELECT payload_json
            FROM workflow_actions
            ORDER BY created_at_iso ASC
            """
        ).fetchall()
        return [
            self._deserialize_workflow_action(self._loads(row["payload_json"]))
            for row in rows
        ]

    def replace_workflow_actions(self, actions: Iterable[WorkflowActionEntry]) -> None:
        action_list = list(actions)
        self._replace_timestamped_payload_rows(
            "workflow_actions",
            "action_id",
            ((action.id, action.created_at_iso, self._dumps(asdict(action))) for action in action_list),
        )

    def load_workflow_sessions(self, limit: int = 20) -> List[WorkflowSessionEntry]:
        rows = self.connection.execute(
            """
            SELECT payload_json
            FROM workflow_sessions
            ORDER BY created_at_iso DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [
            self._deserialize_workflow_session(self._loads(row["payload_json"]))
            for row in rows
        ]

    def replace_workflow_sessions(
        self, sessions: Iterable[WorkflowSessionEntry]
    ) -> None:
        session_list = list(sessions)
        self._replace_timestamped_payload_rows(
            "workflow_sessions",
            "session_id",
            ((session.id, session.created_at_iso, self._dumps(asdict(session))) for session in session_list),
        )

    def _replace_timestamped_payload_rows(
        self,
        table_name: str,
        id_column: str,
        rows: Iterable[tuple[str, str, str]],
    ) -> None:
        row_list = list(rows)
        with self.connection:
            for row_id, created_at_iso, payload_json in row_list:
                self.connection.execute(
                    f"""
                    INSERT INTO {table_name}({id_column}, created_at_iso, payload_json)
                    VALUES (?, ?, ?)
                    ON CONFLICT({id_column}) DO UPDATE SET
                        created_at_iso=excluded.created_at_iso,
                        payload_json=excluded.payload_json
                    """,
                    (row_id, created_at_iso, payload_json),
                )
            if row_list:
                placeholders = ",".join("?" for _ in row_list)
                self.connection.execute(
                    f"DELETE FROM {table_name} WHERE {id_column} NOT IN ({placeholders})",
                    [row_id for row_id, _, _ in row_list],
                )
            else:
                self.connection.execute(f"DELETE FROM {table_name}")

    def _deserialize_annotations(self, payload: object) -> List[WaveformAnnotation]:
        if not isinstance(payload, list):
            return []
        annotations: List[WaveformAnnotation] = []
        for raw in payload:
            if not isinstance(raw, dict):
                continue
            annotations.append(
                WaveformAnnotation(
                    id=str(raw.get("id") or ""),
                    label=str(raw.get("label") or "Annotation"),
                    notes=str(raw.get("notes") or ""),
                    channel_name=(
                        str(raw.get("channel_name") or raw.get("channelName"))
                        if (
                            raw.get("channel_name") is not None
                            or raw.get("channelName") is not None
                        )
                        else None
                    ),
                    start_seconds=float(
                        raw.get("start_seconds") or raw.get("startSeconds") or 0.0
                    ),
                    end_seconds=(
                        float(raw.get("end_seconds") or raw.get("endSeconds"))
                        if (
                            raw.get("end_seconds") is not None
                            or raw.get("endSeconds") is not None
                        )
                        else None
                    ),
                )
            )
        return annotations

    def _deserialize_dda_result(self, payload: object) -> DdaResult:
        data = payload if isinstance(payload, dict) else {}
        variants = [
            DdaVariantResult(
                id=str(item.get("id") or "variant"),
                label=str(item.get("label") or ""),
                row_labels=[str(value) for value in item.get("row_labels", [])],
                matrix=[
                    [float(value) for value in row]
                    for row in item.get("matrix", [])
                    if isinstance(row, list)
                ],
                summary=str(item.get("summary") or ""),
                min_value=float(item.get("min_value") or 0.0),
                max_value=float(item.get("max_value") or 0.0),
            )
            for item in data.get("variants", [])
            if isinstance(item, dict)
        ]
        return DdaResult(
            id=str(data.get("id") or ""),
            file_path=str(data.get("file_path") or data.get("filePath") or ""),
            file_name=str(data.get("file_name") or data.get("fileName") or ""),
            created_at_iso=str(
                data.get("created_at_iso") or data.get("createdAtIso") or ""
            ),
            engine_label=str(data.get("engine_label") or data.get("engineLabel") or ""),
            diagnostics=[str(value) for value in data.get("diagnostics", [])],
            window_centers_seconds=[
                float(value)
                for value in (
                    data.get("window_centers_seconds")
                    or data.get("windowCentersSeconds")
                    or []
                )
            ],
            variants=variants,
            is_fallback=bool(data.get("is_fallback", data.get("isFallback", False))),
        )

    def _deserialize_dda_result_summary(self, row: sqlite3.Row) -> DdaResultSummary:
        payload = self._loads(str(row["payload_json"])) if row["payload_json"] else {}
        payload_data = payload if isinstance(payload, dict) else {}
        variant_ids_payload = self._loads(str(row["variant_ids_json"] or "[]"))
        variant_ids = (
            [str(value) for value in variant_ids_payload if isinstance(value, str)]
            if isinstance(variant_ids_payload, list)
            else []
        )
        if not variant_ids:
            variant_ids = [
                str(item.get("id") or "")
                for item in payload_data.get("variants", [])
                if isinstance(item, dict) and item.get("id")
            ]
        file_name = str(row["file_name"] or "") or str(
            payload_data.get("file_name") or payload_data.get("fileName") or ""
        )
        engine_label = str(row["engine_label"] or "") or str(
            payload_data.get("engine_label") or payload_data.get("engineLabel") or ""
        )
        is_fallback = (
            bool(int(row["is_fallback"]))
            if row["is_fallback"] is not None
            else bool(
                payload_data.get("is_fallback", payload_data.get("isFallback", False))
            )
        )
        return DdaResultSummary(
            id=str(row["result_id"] or ""),
            file_path=str(row["file_path"] or ""),
            file_name=file_name,
            created_at_iso=str(row["created_at_iso"] or ""),
            engine_label=engine_label,
            variant_ids=variant_ids,
            is_fallback=is_fallback,
        )

    def _deserialize_ica_result(self, payload: object) -> IcaResult:
        data = payload if isinstance(payload, dict) else {}
        components = [
            IcaComponent(
                component_id=int(
                    item.get("component_id") or item.get("componentId") or 0
                ),
                spatial_map=[
                    float(value)
                    for value in (
                        item.get("spatial_map") or item.get("spatialMap") or []
                    )
                ],
                time_series_preview=[
                    float(value)
                    for value in (
                        item.get("time_series_preview")
                        or item.get("timeSeriesPreview")
                        or []
                    )
                ],
                kurtosis=float(item.get("kurtosis") or 0.0),
                non_gaussianity=float(
                    item.get("non_gaussianity") or item.get("nonGaussianity") or 0.0
                ),
                variance_explained=float(
                    item.get("variance_explained")
                    or item.get("varianceExplained")
                    or 0.0
                ),
                power_frequencies=[
                    float(value)
                    for value in (
                        item.get("power_frequencies")
                        or item.get("powerFrequencies")
                        or []
                    )
                ],
                power_values=[
                    float(value)
                    for value in (
                        item.get("power_values") or item.get("powerValues") or []
                    )
                ],
            )
            for item in data.get("components", [])
            if isinstance(item, dict)
        ]
        return IcaResult(
            id=str(data.get("id") or ""),
            file_path=str(data.get("file_path") or data.get("filePath") or ""),
            file_name=str(data.get("file_name") or data.get("fileName") or ""),
            created_at_iso=str(
                data.get("created_at_iso") or data.get("createdAtIso") or ""
            ),
            channel_names=[
                str(value)
                for value in (
                    data.get("channel_names") or data.get("channelNames") or []
                )
            ],
            sample_rate_hz=float(
                data.get("sample_rate_hz") or data.get("sampleRateHz") or 0.0
            ),
            sample_count=int(data.get("sample_count") or data.get("sampleCount") or 0),
            components=components,
        )

    def _deserialize_notification(self, payload: object) -> NotificationEntry:
        data = payload if isinstance(payload, dict) else {}
        return NotificationEntry(
            id=str(data.get("id") or ""),
            category=str(data.get("category") or ""),
            level=str(data.get("level") or ""),
            title=str(data.get("title") or ""),
            message=str(data.get("message") or ""),
            created_at_iso=str(
                data.get("created_at_iso") or data.get("createdAtIso") or ""
            ),
        )

    def _deserialize_workflow_action(self, payload: object) -> WorkflowActionEntry:
        data = payload if isinstance(payload, dict) else {}
        payload_data = data.get("payload")
        return WorkflowActionEntry(
            id=str(data.get("id") or ""),
            action_type=str(data.get("action_type") or data.get("actionType") or ""),
            description=str(data.get("description") or ""),
            created_at_iso=str(
                data.get("created_at_iso") or data.get("createdAtIso") or ""
            ),
            file_path=(
                str(data.get("file_path") or data.get("filePath"))
                if (
                    data.get("file_path") is not None
                    or data.get("filePath") is not None
                )
                else None
            ),
            payload=payload_data if isinstance(payload_data, dict) else {},
        )

    def _deserialize_workflow_session(self, payload: object) -> WorkflowSessionEntry:
        data = payload if isinstance(payload, dict) else {}
        return WorkflowSessionEntry(
            id=str(data.get("id") or ""),
            name=str(data.get("name") or "DDALAB workflow"),
            created_at_iso=str(
                data.get("created_at_iso") or data.get("createdAtIso") or ""
            ),
            actions=self._deserialize_workflow_actions(data.get("actions")),
        )

    def _deserialize_workflow_actions(
        self, payload: object
    ) -> List[WorkflowActionEntry]:
        if not isinstance(payload, list):
            return []
        return [
            self._deserialize_workflow_action(item)
            for item in payload
            if isinstance(item, dict)
        ]

    @staticmethod
    def _loads(value: str) -> object:
        try:
            return json.loads(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _dumps(value: object) -> str:
        return json.dumps(value, separators=(",", ":"))
