import json
import sqlite3
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "logistics.db"


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {key: row[key] for key in row.keys()}


def init_db() -> None:
    with get_connection() as conn:
        cursor = conn.cursor()

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                age INTEGER
            )
            """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS routes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                origin TEXT NOT NULL,
                destination TEXT NOT NULL,
                carrier TEXT,
                mode TEXT,
                status TEXT
            )
            """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS deliveries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                route_id INTEGER,
                driver_id INTEGER,
                dispatch_time TEXT,
                status TEXT,
                FOREIGN KEY(route_id) REFERENCES routes(id),
                FOREIGN KEY(driver_id) REFERENCES users(id)
            )
            """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS risk_assessment (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                delivery_id INTEGER,
                risk_score REAL,
                reason TEXT,
                suggestion TEXT,
                FOREIGN KEY(delivery_id) REFERENCES deliveries(id)
            )
            """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS trip_analyses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                origin TEXT NOT NULL,
                destination TEXT NOT NULL,
                recommended_route TEXT NOT NULL,
                recommended_risk_level TEXT NOT NULL,
                recommended_risk_score REAL NOT NULL,
                reason TEXT NOT NULL,
                suggestion TEXT NOT NULL,
                routes_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS app_users (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                role TEXT NOT NULL,
                password TEXT NOT NULL
            )
            """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS app_drivers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                phone TEXT NOT NULL,
                email TEXT NOT NULL,
                vehicle_number TEXT NOT NULL,
                current_location TEXT,
                status TEXT NOT NULL
            )
            """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS app_shipments (
                id TEXT PRIMARY KEY,
                driver_id TEXT,
                status TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS app_driver_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                shipment_id TEXT NOT NULL,
                driver_id TEXT,
                disruption_type TEXT NOT NULL,
                severity TEXT NOT NULL,
                location TEXT NOT NULL,
                description TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        conn.commit()


def save_trip_analysis(
    origin: str,
    destination: str,
    recommended_route: str,
    recommended_risk_level: str,
    recommended_risk_score: float,
    reason: str,
    suggestion: str,
    routes: list[dict[str, Any]],
) -> None:
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO trip_analyses (
                origin,
                destination,
                recommended_route,
                recommended_risk_level,
                recommended_risk_score,
                reason,
                suggestion,
                routes_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                origin,
                destination,
                recommended_route,
                recommended_risk_level,
                recommended_risk_score,
                reason,
                suggestion,
                json.dumps(routes),
            ),
        )
        conn.commit()


def upsert_app_user(user: dict[str, Any]) -> None:
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO app_users (id, name, email, role, password)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                email=excluded.email,
                role=excluded.role,
                password=excluded.password
            """,
            (
                user["id"],
                user["name"],
                user["email"],
                user["role"],
                user["password"],
            ),
        )
        conn.commit()


def upsert_app_driver(driver: dict[str, Any]) -> None:
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO app_drivers (id, name, phone, email, vehicle_number, current_location, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                phone=excluded.phone,
                email=excluded.email,
                vehicle_number=excluded.vehicle_number,
                current_location=excluded.current_location,
                status=excluded.status
            """,
            (
                driver["id"],
                driver["name"],
                driver["phone"],
                driver["email"],
                driver["vehicle_number"],
                driver.get("current_location"),
                driver["status"],
            ),
        )
        conn.commit()


def upsert_app_shipment(shipment: dict[str, Any]) -> None:
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO app_shipments (id, driver_id, status, payload_json, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                driver_id=excluded.driver_id,
                status=excluded.status,
                payload_json=excluded.payload_json,
                updated_at=CURRENT_TIMESTAMP
            """,
            (
                shipment["id"],
                shipment.get("driverId"),
                shipment["status"],
                json.dumps(shipment),
            ),
        )
        conn.commit()


def get_app_user_by_credentials(email: str, password: str) -> dict[str, Any] | None:
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, name, email, role
            FROM app_users
            WHERE email = ? AND password = ?
            """,
            (email, password),
        ).fetchone()
    return row_to_dict(row)


def list_app_drivers() -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, name, phone, email, vehicle_number, current_location, status
            FROM app_drivers
            ORDER BY name
            """
        ).fetchall()
    return [row_to_dict(row) for row in rows if row_to_dict(row) is not None]


def list_app_shipments(driver_id: str | None = None) -> list[dict[str, Any]]:
    with get_connection() as conn:
        if driver_id:
            rows = conn.execute(
                """
                SELECT payload_json
                FROM app_shipments
                WHERE driver_id = ?
                ORDER BY updated_at DESC
                """,
                (driver_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT payload_json
                FROM app_shipments
                ORDER BY updated_at DESC
                """
            ).fetchall()

    payloads: list[dict[str, Any]] = []
    for row in rows:
        raw = row["payload_json"]
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                payloads.append(parsed)
        except Exception:
            continue
    return payloads


def get_app_shipment(shipment_id: str) -> dict[str, Any] | None:
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT payload_json
            FROM app_shipments
            WHERE id = ?
            """,
            (shipment_id,),
        ).fetchone()
    if row is None:
        return None
    try:
        payload = json.loads(row["payload_json"])
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


def app_store_counts() -> dict[str, int]:
    with get_connection() as conn:
        users_count = int(conn.execute("SELECT COUNT(*) FROM app_users").fetchone()[0])
        drivers_count = int(conn.execute("SELECT COUNT(*) FROM app_drivers").fetchone()[0])
        shipments_count = int(conn.execute("SELECT COUNT(*) FROM app_shipments").fetchone()[0])
    return {
        "users": users_count,
        "drivers": drivers_count,
        "shipments": shipments_count,
    }


def create_app_driver_report(report: dict[str, Any]) -> dict[str, Any]:
    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO app_driver_reports (
                shipment_id,
                driver_id,
                disruption_type,
                severity,
                location,
                description,
                active
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                report["shipment_id"],
                report.get("driver_id"),
                report["disruption_type"],
                report["severity"],
                report["location"],
                report["description"],
                1 if report.get("active", True) else 0,
            ),
        )
        report_id = int(cursor.lastrowid)
        conn.commit()

        row = conn.execute(
            """
            SELECT id, shipment_id, driver_id, disruption_type, severity, location, description, active, created_at
            FROM app_driver_reports
            WHERE id = ?
            """,
            (report_id,),
        ).fetchone()
    result = row_to_dict(row)
    return result if result is not None else {}


def list_app_driver_reports(shipment_id: str | None = None, active_only: bool = True) -> list[dict[str, Any]]:
    with get_connection() as conn:
        if shipment_id and active_only:
            rows = conn.execute(
                """
                SELECT id, shipment_id, driver_id, disruption_type, severity, location, description, active, created_at
                FROM app_driver_reports
                WHERE shipment_id = ? AND active = 1
                ORDER BY created_at DESC
                """,
                (shipment_id,),
            ).fetchall()
        elif shipment_id:
            rows = conn.execute(
                """
                SELECT id, shipment_id, driver_id, disruption_type, severity, location, description, active, created_at
                FROM app_driver_reports
                WHERE shipment_id = ?
                ORDER BY created_at DESC
                """,
                (shipment_id,),
            ).fetchall()
        elif active_only:
            rows = conn.execute(
                """
                SELECT id, shipment_id, driver_id, disruption_type, severity, location, description, active, created_at
                FROM app_driver_reports
                WHERE active = 1
                ORDER BY created_at DESC
                """
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT id, shipment_id, driver_id, disruption_type, severity, location, description, active, created_at
                FROM app_driver_reports
                ORDER BY created_at DESC
                """
            ).fetchall()

    reports: list[dict[str, Any]] = []
    for row in rows:
        report = row_to_dict(row)
        if report is not None:
            reports.append(report)
    return reports


init_db()
