from __future__ import annotations

import threading
from typing import List, Optional, Tuple

import requests

from ...domain.models import OpenNeuroDataset

OPEN_NEURO_GRAPHQL_ENDPOINT = "https://openneuro.org/crn/graphql"
OPEN_NEURO_BATCH_QUERY = """
query PublicDatasets($after: String, $first: Int!) {
  datasets(first: $first, after: $after) {
    edges {
      cursor
      node {
        id
        latestSnapshot {
          tag
          created
          description {
            Name
          }
          summary {
            modalities
            subjects
            tasks
            size
            totalFiles
          }
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
"""


class _RequestsSessionPool:
    def __init__(
        self,
        headers: Optional[dict[str, str]] = None,
        *,
        pool_connections: int = 8,
        pool_maxsize: int = 8,
    ) -> None:
        self._headers = headers or {}
        self._pool_connections = pool_connections
        self._pool_maxsize = pool_maxsize
        self._local = threading.local()
        self._lock = threading.Lock()
        self._sessions: list[requests.Session] = []

    def session(self) -> requests.Session:
        session = getattr(self._local, "session", None)
        if session is not None:
            return session
        session = requests.Session()
        adapter = requests.adapters.HTTPAdapter(
            pool_connections=self._pool_connections,
            pool_maxsize=self._pool_maxsize,
            max_retries=0,
        )
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        session.headers.update(self._headers)
        with self._lock:
            self._sessions.append(session)
        self._local.session = session
        return session

    def close(self) -> None:
        with self._lock:
            sessions = list(self._sessions)
            self._sessions.clear()
        for session in sessions:
            try:
                session.close()
            except Exception:
                continue


class OpenNeuroClient:
    def __init__(self) -> None:
        self._headers = {"Content-Type": "application/json"}
        self._session_pool = _RequestsSessionPool(
            self._headers, pool_connections=4, pool_maxsize=4
        )

    def list_datasets(
        self,
        limit: int = 50,
        after: Optional[str] = None,
    ) -> Tuple[List[OpenNeuroDataset], Optional[str], bool]:
        response = self._session_pool.session().request(
            "POST",
            OPEN_NEURO_GRAPHQL_ENDPOINT,
            json={
                "query": OPEN_NEURO_BATCH_QUERY,
                "variables": {"after": after, "first": max(1, min(limit, 100))},
            },
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        connection = payload["data"]["datasets"]
        datasets: List[OpenNeuroDataset] = []
        for edge in connection.get("edges", []):
            node = edge.get("node")
            if not node:
                continue
            snapshot = node.get("latestSnapshot") or {}
            description = snapshot.get("description") or {}
            summary = snapshot.get("summary") or {}
            datasets.append(
                OpenNeuroDataset(
                    dataset_id=node["id"],
                    name=(description.get("Name") or node["id"]).strip(),
                    description=(description.get("Name") or "").strip(),
                    created_at_iso=snapshot.get("created"),
                    snapshot_tag=snapshot.get("tag"),
                    modalities=list(summary.get("modalities") or []),
                    subjects=_coerce_optional_int(summary.get("subjects")),
                    tasks=list(summary.get("tasks") or []),
                    size_bytes=_coerce_optional_int(summary.get("size")),
                    total_files=_coerce_optional_int(summary.get("totalFiles")),
                )
            )
        page_info = connection.get("pageInfo") or {}
        return (
            datasets,
            page_info.get("endCursor"),
            bool(page_info.get("hasNextPage", False)),
        )

    def close(self) -> None:
        self._session_pool.close()


def _coerce_optional_int(value: object) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
