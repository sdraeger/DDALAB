from typing import Any

from pydantic import BaseModel


class EdfConfig(BaseModel):
    user_id: int
    file_hash: str
    config: dict[str, Any]
