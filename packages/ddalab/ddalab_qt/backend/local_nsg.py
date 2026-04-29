from __future__ import annotations

import json
import os
import sqlite3
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, List, Optional

import requests
from defusedxml import ElementTree as DefusedElementTree

from ..domain.models import NsgCredentialsStatus, NsgJobSnapshot
from ..runtime_paths import RuntimePaths


NSG_BASE_URL = "https://nsgr.sdsc.edu:8443/cipresrest/v1"
_ACTIVE_NSG_STATUSES = {"submitted", "queue", "inputstaging", "running"}
_TERMINAL_NSG_STATUSES = {"completed", "failed", "cancelled"}


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _iter_children_by_name(node, name: str):
    for child in list(node):
        if _local_name(child.tag) == name:
            yield child


def _find_child(node, name: str):
    return next(_iter_children_by_name(node, name), None)


def _find_text(node, *path: str) -> Optional[str]:
    current = node
    for name in path:
        current = _find_child(current, name)
        if current is None:
            return None
    text = current.text or ""
    stripped = text.strip()
    return stripped or None


def _coerce_status(job_stage: Optional[str], failed: bool) -> str:
    if failed:
        return "failed"
    stage = (job_stage or "").strip().upper()
    if stage == "SUBMITTED":
        return "submitted"
    if stage == "QUEUE":
        return "queue"
    if stage == "INPUTSTAGING":
        return "inputstaging"
    if stage in {"RUNNING", "RUN"}:
        return "running"
    if stage in {"COMPLETED", "COMPLETE"}:
        return "completed"
    if stage in {"FAILED", "TERMINATED", "CANCELLED"}:
        return "failed" if stage != "CANCELLED" else "cancelled"
    return "submitted"


def _parse_failed_text(text: Optional[str]) -> bool:
    return str(text or "").strip().lower() == "true"


def _parse_job_list_xml(
    xml_text: str,
    *,
    base_url: str,
    username: str,
) -> List[tuple[str, str]]:
    root = DefusedElementTree.fromstring(xml_text)
    jobs: List[tuple[str, str]] = []
    seen: set[str] = set()
    for node in root.iter():
        if _local_name(node.tag) != "jobstatus":
            continue
        handle = _find_text(node, "selfUri", "title")
        if not handle or handle in seen:
            continue
        url = _find_text(node, "selfUri", "url") or (
            f"{base_url}/job/{username}/{handle}"
        )
        jobs.append((handle, url.replace("&amp;", "&")))
        seen.add(handle)
    return jobs


def _parse_job_status_xml(xml_text: str) -> dict:
    root = DefusedElementTree.fromstring(xml_text)
    job_stage = _find_text(root, "jobStage")
    failed = _parse_failed_text(_find_text(root, "failed"))
    results_uri = _find_text(root, "resultsUri", "url")
    output_files = []
    for node in root.iter():
        if _local_name(node.tag) != "jobfile":
            continue
        filename = _find_text(node, "filename")
        download_uri = _find_text(node, "downloadUri", "url")
        if not filename or not download_uri:
            continue
        length_text = _find_text(node, "length")
        try:
            length = int(length_text) if length_text is not None else 0
        except ValueError:
            length = 0
        output_files.append(
            {
                "filename": filename,
                "download_uri": download_uri.replace("&amp;", "&"),
                "length": length,
            }
        )
    messages: List[str] = []
    for node in root.iter():
        if _local_name(node.tag) != "message":
            continue
        message_text = _find_text(node, "text")
        if message_text:
            messages.append(message_text)
    submitted_at = (
        _find_text(root, "dateSubmitted")
        or _find_text(root, "dateEntered")
        or _find_text(root, "dateCreated")
    )
    completed_at = (
        _find_text(root, "dateCompleted")
        or _find_text(root, "dateTerminated")
        or _find_text(root, "dateEnded")
    )
    return {
        "job_stage": job_stage,
        "failed": failed,
        "status": _coerce_status(job_stage, failed),
        "results_uri": results_uri.replace("&amp;", "&") if results_uri else None,
        "output_files": output_files,
        "messages": messages,
        "submitted_at": submitted_at,
        "completed_at": completed_at,
    }


def _parse_output_files_xml(xml_text: str) -> List[dict]:
    root = DefusedElementTree.fromstring(xml_text)
    files: List[dict] = []
    for node in root.iter():
        if _local_name(node.tag) != "jobfile":
            continue
        filename = _find_text(node, "filename")
        download_uri = _find_text(node, "downloadUri", "url")
        if not filename or not download_uri:
            continue
        length_text = _find_text(node, "length")
        try:
            length = int(length_text) if length_text is not None else 0
        except ValueError:
            length = 0
        files.append(
            {
                "filename": filename,
                "download_uri": download_uri.replace("&amp;", "&"),
                "length": length,
            }
        )
    return files


@dataclass
class NsgJobRecord:
    id: str
    nsg_job_id: Optional[str]
    tool: str
    status: str
    created_at: str
    submitted_at: Optional[str]
    completed_at: Optional[str]
    request_payload_json: str
    input_file_path: str
    output_files: List[str] = field(default_factory=list)
    error_message: Optional[str] = None
    last_polled: Optional[str] = None
    progress: Optional[int] = None

    def to_snapshot(self) -> NsgJobSnapshot:
        return NsgJobSnapshot(
            job_id=self.id,
            nsg_job_id=self.nsg_job_id,
            tool=self.tool,
            status=self.status,
            created_at=self.created_at,
            submitted_at=self.submitted_at,
            completed_at=self.completed_at,
            input_file_path=self.input_file_path,
            output_files=list(self.output_files),
            error_message=self.error_message,
            last_polled=self.last_polled,
            progress=self.progress,
        )


class NsgCredentialsStore:
    def __init__(self, base_dir: Path) -> None:
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.path = self.base_dir / "nsg_credentials.json"
        self._lock = threading.Lock()

    def save(self, username: str, password: str, app_key: str) -> None:
        payload = {
            "username": username,
            "password": password,
            "app_key": app_key,
        }
        with self._lock:
            self.path.write_text(json.dumps(payload), encoding="utf-8")
            try:
                os.chmod(self.path, 0o600)
            except OSError:
                pass

    def load(self) -> Optional[dict]:
        with self._lock:
            if not self.path.exists():
                return None
            try:
                payload = json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, ValueError, TypeError):
                return None
        if not isinstance(payload, dict):
            return None
        username = str(payload.get("username") or "").strip()
        password = str(payload.get("password") or "")
        app_key = str(payload.get("app_key") or "")
        if not username or not password or not app_key:
            return None
        return {
            "username": username,
            "password": password,
            "app_key": app_key,
        }

    def delete(self) -> None:
        with self._lock:
            if self.path.exists():
                self.path.unlink()

    def status(self) -> Optional[NsgCredentialsStatus]:
        credentials = self.load()
        if credentials is None:
            return None
        return NsgCredentialsStatus(
            username=credentials["username"],
            has_password=bool(credentials["password"]),
            has_app_key=bool(credentials["app_key"]),
        )


class NsgJobsStore:
    def __init__(self, db_path: Path) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._connection = sqlite3.connect(self.db_path, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._connection.execute("PRAGMA journal_mode=WAL")
        self._init_schema()

    def close(self) -> None:
        self._connection.close()

    def _init_schema(self) -> None:
        with self._connection:
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS nsg_jobs (
                    id TEXT PRIMARY KEY,
                    nsg_job_id TEXT,
                    tool TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    submitted_at TEXT,
                    completed_at TEXT,
                    request_payload_json TEXT NOT NULL,
                    input_file_path TEXT NOT NULL,
                    output_files_json TEXT NOT NULL,
                    error_message TEXT,
                    last_polled TEXT,
                    progress INTEGER
                )
                """
            )
            self._connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_nsg_jobs_created_at ON nsg_jobs(created_at DESC)"
            )
            self._connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_nsg_jobs_nsg_job_id ON nsg_jobs(nsg_job_id)"
            )

    def save(self, job: NsgJobRecord) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                """
                INSERT OR REPLACE INTO nsg_jobs (
                    id, nsg_job_id, tool, status, created_at, submitted_at, completed_at,
                    request_payload_json, input_file_path, output_files_json,
                    error_message, last_polled, progress
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job.id,
                    job.nsg_job_id,
                    job.tool,
                    job.status,
                    job.created_at,
                    job.submitted_at,
                    job.completed_at,
                    job.request_payload_json,
                    job.input_file_path,
                    json.dumps(job.output_files),
                    job.error_message,
                    job.last_polled,
                    job.progress,
                ),
            )

    def get(self, job_id: str) -> Optional[NsgJobRecord]:
        row = self._connection.execute(
            """
            SELECT id, nsg_job_id, tool, status, created_at, submitted_at, completed_at,
                   request_payload_json, input_file_path, output_files_json,
                   error_message, last_polled, progress
            FROM nsg_jobs
            WHERE id = ?
            """,
            (job_id,),
        ).fetchone()
        return self._record_from_row(row)

    def list(self) -> List[NsgJobRecord]:
        rows = self._connection.execute(
            """
            SELECT id, nsg_job_id, tool, status, created_at, submitted_at, completed_at,
                   request_payload_json, input_file_path, output_files_json,
                   error_message, last_polled, progress
            FROM nsg_jobs
            ORDER BY created_at DESC
            """
        ).fetchall()
        return [record for row in rows if (record := self._record_from_row(row)) is not None]

    def _record_from_row(self, row) -> Optional[NsgJobRecord]:
        if row is None:
            return None
        try:
            output_files = json.loads(row["output_files_json"] or "[]")
        except (TypeError, ValueError):
            output_files = []
        return NsgJobRecord(
            id=str(row["id"]),
            nsg_job_id=str(row["nsg_job_id"]) if row["nsg_job_id"] else None,
            tool=str(row["tool"]),
            status=str(row["status"]),
            created_at=str(row["created_at"]),
            submitted_at=str(row["submitted_at"]) if row["submitted_at"] else None,
            completed_at=str(row["completed_at"]) if row["completed_at"] else None,
            request_payload_json=str(row["request_payload_json"]),
            input_file_path=str(row["input_file_path"]),
            output_files=[str(item) for item in output_files if isinstance(item, str)],
            error_message=str(row["error_message"]) if row["error_message"] else None,
            last_polled=str(row["last_polled"]) if row["last_polled"] else None,
            progress=int(row["progress"]) if row["progress"] is not None else None,
        )


class NsgClient:
    def __init__(
        self,
        username: str,
        password: str,
        app_key: str,
        *,
        base_url: str = NSG_BASE_URL,
        session: Optional[requests.Session] = None,
    ) -> None:
        self.username = username
        self.password = password
        self.app_key = app_key
        self.base_url = base_url.rstrip("/")
        self.session = session or requests.Session()

    def _request(self, method: str, url: str, **kwargs) -> requests.Response:
        response = self.session.request(
            method,
            url,
            auth=(self.username, self.password),
            headers={"cipres-appkey": self.app_key},
            timeout=kwargs.pop("timeout", 300),
            **kwargs,
        )
        return response

    def test_connection(self) -> bool:
        response = self._request("GET", f"{self.base_url}/job/{self.username}", timeout=30)
        return response.ok or response.status_code == 404

    def list_user_jobs(self) -> List[tuple[str, str]]:
        response = self._request("GET", f"{self.base_url}/job/{self.username}", timeout=60)
        response.raise_for_status()
        return _parse_job_list_xml(
            response.text,
            base_url=self.base_url,
            username=self.username,
        )

    def get_job_status(self, job_url: str) -> dict:
        response = self._request("GET", job_url, timeout=60)
        response.raise_for_status()
        return _parse_job_status_xml(response.text)

    def cancel_job(self, job_url: str) -> None:
        response = self._request("DELETE", job_url, timeout=60)
        response.raise_for_status()

    def list_output_files(self, results_uri: str) -> List[dict]:
        response = self._request("GET", results_uri, timeout=60)
        response.raise_for_status()
        return _parse_output_files_xml(response.text)

    def download_output_file(self, download_uri: str, output_path: Path) -> Path:
        response = self._request("GET", download_uri, timeout=300, stream=True)
        response.raise_for_status()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with output_path.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    handle.write(chunk)
        return output_path


class LocalNsgManager:
    def __init__(
        self,
        runtime_paths: RuntimePaths,
        *,
        base_dir: Optional[Path] = None,
    ) -> None:
        _ = runtime_paths
        self.base_dir = Path(base_dir or (Path.home() / ".ddalab-qt"))
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.credentials_store = NsgCredentialsStore(self.base_dir)
        self.jobs_store = NsgJobsStore(self.base_dir / "nsg_jobs.sqlite3")
        self.results_dir = self.base_dir / "nsg-results"
        self.results_dir.mkdir(parents=True, exist_ok=True)

    def close(self) -> None:
        self.jobs_store.close()

    def supports_submission(self) -> bool:
        return False

    def get_credentials_status(self) -> Optional[NsgCredentialsStatus]:
        return self.credentials_store.status()

    def save_credentials(self, username: str, password: str, app_key: str) -> None:
        self.credentials_store.save(username, password, app_key)

    def delete_credentials(self) -> None:
        self.credentials_store.delete()

    def test_connection(self) -> bool:
        client = self._client()
        if client is None:
            return False
        return client.test_connection()

    def list_jobs(self) -> List[NsgJobSnapshot]:
        client = self._client()
        if client is None:
            return []
        local_jobs = self.jobs_store.list()
        local_by_nsg_id = {
            job.nsg_job_id: job for job in local_jobs if job.nsg_job_id
        }
        snapshots = [job.to_snapshot() for job in local_jobs]
        for job_handle, job_url in client.list_user_jobs():
            if job_handle in local_by_nsg_id:
                continue
            try:
                snapshots.append(
                    self._build_external_snapshot(
                        client=client,
                        job_id=f"external_{job_handle}",
                        nsg_job_id=job_handle,
                        job_url=job_url,
                    )
                )
            except Exception:
                snapshots.append(
                    NsgJobSnapshot(
                        job_id=f"external_{job_handle}",
                        nsg_job_id=job_handle,
                        tool="PY_EXPANSE",
                        status="submitted",
                        created_at=_utcnow_iso(),
                        submitted_at=None,
                        completed_at=None,
                        input_file_path="",
                        output_files=[],
                        error_message=None,
                        last_polled=_utcnow_iso(),
                        progress=None,
                    )
                )
        snapshots.sort(key=lambda item: item.created_at, reverse=True)
        return snapshots

    def refresh_job(self, job_id: str) -> NsgJobSnapshot:
        client = self._client_required()
        if job_id.startswith("external_"):
            nsg_job_id = job_id.removeprefix("external_")
            job_url = f"{client.base_url}/job/{client.username}/{nsg_job_id}"
            return self._build_external_snapshot(
                client=client,
                job_id=job_id,
                nsg_job_id=nsg_job_id,
                job_url=job_url,
            )
        record = self.jobs_store.get(job_id)
        if record is None:
            raise RuntimeError(f"NSG job not found: {job_id}")
        if not record.nsg_job_id:
            return record.to_snapshot()
        job_url = f"{client.base_url}/job/{client.username}/{record.nsg_job_id}"
        status_payload = client.get_job_status(job_url)
        record.status = str(status_payload["status"])
        record.submitted_at = status_payload["submitted_at"] or record.submitted_at
        if record.status in _TERMINAL_NSG_STATUSES:
            record.completed_at = status_payload["completed_at"] or record.completed_at or _utcnow_iso()
        record.output_files = [
            str(item["filename"]) for item in status_payload["output_files"]
        ]
        record.error_message = self._coalesce_error_message(status_payload["messages"])
        record.last_polled = _utcnow_iso()
        self.jobs_store.save(record)
        return record.to_snapshot()

    def cancel_job(self, job_id: str) -> None:
        client = self._client_required()
        if job_id.startswith("external_"):
            nsg_job_id = job_id.removeprefix("external_")
            job_url = f"{client.base_url}/job/{client.username}/{nsg_job_id}"
            client.cancel_job(job_url)
            return
        record = self.jobs_store.get(job_id)
        if record is None:
            raise RuntimeError(f"NSG job not found: {job_id}")
        if record.nsg_job_id:
            job_url = f"{client.base_url}/job/{client.username}/{record.nsg_job_id}"
            client.cancel_job(job_url)
        record.status = "cancelled"
        record.completed_at = _utcnow_iso()
        record.last_polled = _utcnow_iso()
        self.jobs_store.save(record)

    def download_results(self, job_id: str) -> List[str]:
        client = self._client_required()
        if job_id.startswith("external_"):
            nsg_job_id = job_id.removeprefix("external_")
        else:
            record = self.jobs_store.get(job_id)
            if record is None:
                raise RuntimeError(f"NSG job not found: {job_id}")
            if not record.nsg_job_id:
                raise RuntimeError("NSG job has not been submitted yet.")
            nsg_job_id = record.nsg_job_id
        job_url = f"{client.base_url}/job/{client.username}/{nsg_job_id}"
        status_payload = client.get_job_status(job_url)
        results_uri = status_payload["results_uri"]
        if not results_uri:
            raise RuntimeError("No NSG results are available for this job yet.")
        output_files = client.list_output_files(results_uri)
        if not output_files:
            raise RuntimeError("NSG returned no downloadable output files for this job.")
        target_dir = self.results_dir / job_id
        downloaded_paths: List[str] = []
        for item in output_files:
            file_name = Path(str(item["filename"])).name
            output_path = target_dir / file_name
            client.download_output_file(str(item["download_uri"]), output_path)
            downloaded_paths.append(str(output_path))
        if not job_id.startswith("external_"):
            record = self.jobs_store.get(job_id)
            if record is not None:
                record.output_files = [Path(path).name for path in downloaded_paths]
                record.last_polled = _utcnow_iso()
                self.jobs_store.save(record)
        return downloaded_paths

    def create_job(self, *args, **kwargs) -> NsgJobSnapshot:
        _ = args, kwargs
        raise RuntimeError(
            "NSG job submission is not mapped into the Qt desktop app yet. "
            "Authenticate in Settings to view and manage existing NSG jobs."
        )

    def submit_job(self, job_id: str) -> NsgJobSnapshot:
        _ = job_id
        raise RuntimeError(
            "NSG job submission is not mapped into the Qt desktop app yet. "
            "Authenticate in Settings to view and manage existing NSG jobs."
        )

    def _client(self) -> Optional[NsgClient]:
        credentials = self.credentials_store.load()
        if credentials is None:
            return None
        return NsgClient(
            credentials["username"],
            credentials["password"],
            credentials["app_key"],
        )

    def _client_required(self) -> NsgClient:
        client = self._client()
        if client is None:
            raise RuntimeError(
                "Authenticate with your NSG username, password, and app key in Settings first."
            )
        return client

    def _build_external_snapshot(
        self,
        *,
        client: NsgClient,
        job_id: str,
        nsg_job_id: str,
        job_url: str,
    ) -> NsgJobSnapshot:
        status_payload = client.get_job_status(job_url)
        created_at = status_payload["submitted_at"] or _utcnow_iso()
        return NsgJobSnapshot(
            job_id=job_id,
            nsg_job_id=nsg_job_id,
            tool="PY_EXPANSE",
            status=str(status_payload["status"]),
            created_at=created_at,
            submitted_at=status_payload["submitted_at"],
            completed_at=status_payload["completed_at"],
            input_file_path="",
            output_files=[
                str(item["filename"]) for item in status_payload["output_files"]
            ],
            error_message=self._coalesce_error_message(status_payload["messages"]),
            last_polled=_utcnow_iso(),
            progress=None,
        )

    def _coalesce_error_message(self, messages: Iterable[str]) -> Optional[str]:
        candidates = [
            str(message).strip()
            for message in messages
            if isinstance(message, str)
            and any(token in message.lower() for token in ("error", "failed"))
        ]
        if candidates:
            return "; ".join(candidates)
        return None


__all__ = [
    "LocalNsgManager",
    "NsgClient",
    "NsgCredentialsStore",
    "NsgJobsStore",
    "NsgJobRecord",
    "_parse_job_list_xml",
    "_parse_job_status_xml",
    "_parse_output_files_xml",
]
