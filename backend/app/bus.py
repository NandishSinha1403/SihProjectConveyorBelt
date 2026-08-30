"""In-process publish/subscribe event bus.

Bridges the synchronous pipeline threads to the asyncio world of the WebSocket
hub. Pipeline code calls :meth:`EventBus.publish` from any thread; subscribers
are asyncio queues drained by the WebSocket handlers.

This is deliberately generic (topic + payload) so later phases -- the simulated
IoT sensor layer, the health scorer, a SCADA/OPC-UA publisher -- can plug into
the exact same bus without touching the vision pipeline.
"""
from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any

log = logging.getLogger(__name__)

# Bounded so a stalled client can never grow memory without limit; when a
# subscriber's queue is full we drop that subscriber's oldest message. Losing a
# frame update is always preferable to blocking the pipeline.
QUEUE_MAXSIZE = 64


class EventBus:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue] = set()
        self._lock = threading.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Record the event loop that publishes should be marshalled onto."""
        self._loop = loop

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_MAXSIZE)
        with self._lock:
            self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        with self._lock:
            self._subscribers.discard(q)

    @property
    def subscriber_count(self) -> int:
        with self._lock:
            return len(self._subscribers)

    def publish(self, topic: str, payload: dict[str, Any] | None = None) -> None:
        """Publish from any thread. Never blocks, never raises."""
        message = {"type": topic, "data": payload or {}}
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        try:
            loop.call_soon_threadsafe(self._deliver, message)
        except RuntimeError:  # loop shutting down
            pass

    def _deliver(self, message: dict[str, Any]) -> None:
        with self._lock:
            targets = list(self._subscribers)
        for q in targets:
            try:
                q.put_nowait(message)
            except asyncio.QueueFull:
                try:
                    q.get_nowait()
                    q.put_nowait(message)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    pass


bus = EventBus()
