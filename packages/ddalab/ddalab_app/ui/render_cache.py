from __future__ import annotations

from collections import OrderedDict
from typing import Generic, Hashable, TypeVar

K = TypeVar("K", bound=Hashable)
V = TypeVar("V")


class LruRenderCache(Generic[K, V]):
    def __init__(self, capacity: int = 8) -> None:
        self._capacity = max(1, int(capacity))
        self._items: OrderedDict[K, V] = OrderedDict()

    @property
    def size(self) -> int:
        return len(self._items)

    def get(self, key: K) -> V | None:
        value = self._items.pop(key, None)
        if value is not None:
            self._items[key] = value
        return value

    def put(self, key: K, value: V) -> None:
        self._items.pop(key, None)
        self._items[key] = value
        while len(self._items) > self._capacity:
            self._items.popitem(last=False)

    def clear(self) -> None:
        self._items.clear()
