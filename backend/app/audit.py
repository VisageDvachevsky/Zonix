from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC
from json import dumps
from typing import Protocol

from app.access import AccessService
from app.database import connect
from app.domain.models import AuditEvent, Role, User


class AuditEventRepository(Protocol):
    def add(self, event: AuditEvent) -> AuditEvent: ...

    def list_recent(self, limit: int = 100) -> tuple[AuditEvent, ...]: ...


@dataclass
class InMemoryAuditEventRepository:
    events: list[AuditEvent] | None = None

    def __post_init__(self) -> None:
        self.events = [] if self.events is None else list(self.events)

    def add(self, event: AuditEvent) -> AuditEvent:
        self.events.append(event)
        return event

    def list_recent(self, limit: int = 100) -> tuple[AuditEvent, ...]:
        recent = sorted(self.events, key=lambda event: event.created_at, reverse=True)
        return tuple(recent[:limit])


class DatabaseAuditEventRepository:
    def __init__(
        self,
        database_url: str,
        connect_fn: Callable[[str | None], object] = connect,
    ) -> None:
        self.database_url = database_url
        self.connect_fn = connect_fn

    def add(self, event: AuditEvent) -> AuditEvent:
        with self.connect_fn(self.database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO audit_events (actor, action, zone_name, backend_name, payload, created_at)
                    VALUES (%s, %s, %s, %s, %s::jsonb, %s)
                    """,
                    (
                        event.actor,
                        event.action,
                        event.zone_name,
                        event.backend_name,
                        dumps(event.payload),
                        event.created_at,
                    ),
                )
            connection.commit()
        return event

    def list_recent(self, limit: int = 100) -> tuple[AuditEvent, ...]:
        with self.connect_fn(self.database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT actor, action, zone_name, backend_name, payload, created_at
                    FROM audit_events
                    ORDER BY created_at DESC, id DESC
                    LIMIT %s
                    """,
                    (limit,),
                )
                rows = cursor.fetchall()

        return tuple(
            AuditEvent(
                actor=str(row[0]),
                action=str(row[1]),
                zone_name=None if row[2] is None else str(row[2]),
                backend_name=None if row[3] is None else str(row[3]),
                payload={} if row[4] is None else dict(row[4]),
                created_at=row[5].astimezone(UTC) if hasattr(row[5], "astimezone") else row[5],
            )
            for row in rows
        )


class AuditService:
    def __init__(
        self,
        repository: AuditEventRepository,
        access_service: AccessService,
    ) -> None:
        self.repository = repository
        self.access_service = access_service

    def log_event(
        self,
        *,
        actor: str,
        action: str,
        zone_name: str | None = None,
        backend_name: str | None = None,
        payload: dict[str, object] | None = None,
    ) -> AuditEvent:
        event = AuditEvent(
            actor=actor,
            action=action,
            zone_name=zone_name,
            backend_name=backend_name,
            payload={} if payload is None else payload,
        )
        return self.repository.add(event)

    def list_events_for_user(self, user: User, limit: int = 100) -> tuple[AuditEvent, ...]:
        events = self.repository.list_recent(limit=limit)
        if user.role == Role.ADMIN:
            return events

        accessible_zone_names = {zone.name for zone in self.access_service.list_accessible_zones(user)}
        visible_events = [
            event
            for event in events
            if event.actor == user.username
            or (event.zone_name is not None and event.zone_name in accessible_zone_names)
        ]
        return tuple(visible_events)
