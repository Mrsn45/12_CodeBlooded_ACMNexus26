# pyright: reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportMissingParameterType=false, reportMissingTypeArgument=false
from __future__ import annotations

import csv
import json
import os
import pickle
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from urllib import parse, request as urllib_request

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from databa import (
    app_store_counts,
    create_app_driver_report,
    get_app_shipment,
    get_app_user_by_credentials,
    list_app_driver_reports,
    list_app_drivers,
    list_app_shipments,
    save_trip_analysis,
    upsert_app_driver,
    upsert_app_shipment,
    upsert_app_user,
)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent


def resolve_existing_path(candidates: list[str]) -> Path:
    for file_name in candidates:
        candidate_path = BASE_DIR / file_name
        if candidate_path.exists():
            return candidate_path
    raise FileNotFoundError(f"None of the candidate files were found: {candidates}")


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def fetch_json(url: str, timeout: float = 3.0) -> dict[str, Any] | None:
    try:
        with urllib_request.urlopen(url, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if isinstance(payload, dict):
            return payload
    except Exception:
        return None
    return None


def load_local_env() -> None:
    env_path = BASE_DIR / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_local_env()


dataset_path = resolve_existing_path(
    [
        "indian-cities-dataset.csv",
        "indian-cities-dataset (1).csv",
    ]
)

with open(dataset_path, "r", newline="", encoding="utf-8") as csv_file:
    reader = csv.DictReader(csv_file)
    rows: list[dict[str, str]] = []
    for row in reader:
        origin = row.get("Origin")
        destination = row.get("Destination")
        distance = row.get("Distance")
        if origin is None or destination is None or distance is None:
            continue
        rows.append({"Origin": origin, "Destination": destination, "Distance": distance})

graph: dict[str, list[str]] = {}
distance_map: dict[tuple[str, str], float] = {}

for row in rows:
    src = row["Origin"]
    dst = row["Destination"]
    dist = float(row["Distance"])

    if src not in graph:
        graph[src] = []
    graph[src].append(dst)
    distance_map[(src, dst)] = dist

cities: set[str] = {row["Origin"] for row in rows}.union({row["Destination"] for row in rows})

CITY_COORDS: dict[str, tuple[float, float]] = {
    "Mumbai": (19.0760, 72.8777),
    "Pune": (18.5204, 73.8567),
    "Nashik": (19.9975, 73.7898),
    "Ahmedabad": (23.0225, 72.5714),
    "Jaipur": (26.9124, 75.7873),
    "Delhi": (28.6139, 77.2090),
    "Agra": (27.1767, 78.0081),
    "Lucknow": (26.8467, 80.9462),
    "Kanpur": (26.4499, 80.3319),
    "Kolkata": (22.5726, 88.3639),
    "Hyderabad": (17.3850, 78.4867),
    "Bengaluru": (12.9716, 77.5946),
    "Bangalore": (12.9716, 77.5946),
    "Chennai": (13.0827, 80.2707),
    "Surat": (21.1702, 72.8311),
    "Goa": (15.4909, 73.8278),
}

DEFAULT_WEATHER_FALLBACK = 0.35

NEWS_KEYWORDS = [
    "bandh",
    "hartal",
    "harthal",
    "shutdown",
    "protest",
    "protests",
    "procession",
    "processions",
    "demonstration",
    "demonstrations",
    "rally",
    "political rally",
    "agitation",
    "politics",
    "political",
    "bhandh",
    "strike",
    "blockade",
    "road block",
    "road closure",
    "road closed",
    "road diversion",
    "traffic jam",
    "curfew",
    "riot",
    "clash",
    "clashes",
]

HIGH_IMPACT_NEWS_KEYWORDS = {
    "shutdown",
    "protest",
    "protests",
    "procession",
    "processions",
    "demonstration",
    "demonstrations",
    "rally",
    "harthal",
    "hartal",
    "bandh",
    "bhandh",
    "blockade",
    "road block",
    "road closure",
    "road closed",
    "curfew",
    "riot",
    "clash",
    "clashes",
}

LIVE_CACHE_TTL_SECONDS = max(30, int(os.getenv("LIVE_CACHE_TTL_SECONDS", "180")))
LIVE_WEATHER_CACHE: dict[str, tuple[datetime, float, dict[str, Any]]] = {}
LIVE_TRAFFIC_CACHE: dict[str, tuple[datetime, float, dict[str, Any]]] = {}
LIVE_NEWS_CACHE: dict[str, tuple[datetime, float, list[dict[str, Any]], str]] = {}
LIVE_ROUTE_INTEL_CACHE: dict[str, tuple[datetime, dict[str, Any]]] = {}


def cache_is_fresh(cached_at: datetime, ttl_seconds: int = LIVE_CACHE_TTL_SECONDS) -> bool:
    return (datetime.utcnow() - cached_at).total_seconds() <= ttl_seconds


def route_cache_key(route_cities: list[str]) -> str:
    normalized = [city.strip().lower() for city in route_cities if city and city.strip()]
    return "->".join(normalized)

model_path = resolve_existing_path(["delay_model.pkl"])
model: Any = None

try:
    with open(model_path, "rb") as model_file:
        model = pickle.load(model_file)
except Exception:
    model = None


class RouteRequest(BaseModel):
    origin: str
    destination: str


class LoginRequest(BaseModel):
    email: str
    password: str


class AssignDriverRequest(BaseModel):
    shipment_id: str
    driver_id: str


class DelayShipmentRequest(BaseModel):
    shipment_id: str
    delay_hours: int
    note: str | None = None


class DriverDisruptionReportRequest(BaseModel):
    shipment_id: str
    driver_id: str
    disruption_type: str
    severity: str
    location: str
    description: str


class AddShipmentFromAnalysisRequest(BaseModel):
    origin: str
    destination: str
    route: dict[str, Any]


def find_route(source: str, destination: str) -> list[str]:
    if destination in graph.get(source, []):
        return [source, destination]

    for mid in graph.get(source, []):
        if destination in graph.get(mid, []):
            return [source, mid, destination]

    for mid1 in graph.get(source, []):
        for mid2 in graph.get(mid1, []):
            if destination in graph.get(mid2, []):
                return [source, mid1, mid2, destination]

    return [source, destination]


def base_traffic_score() -> float:
    now = datetime.now()
    hour = now.hour
    is_weekend = now.weekday() >= 5

    if 7 <= hour <= 10 or 17 <= hour <= 21:
        score = 0.74
    elif 11 <= hour <= 16:
        score = 0.56
    else:
        score = 0.36

    if is_weekend:
        score -= 0.08

    return clamp(score, 0.2, 0.85)


def baseline_weather_score(city: str) -> float:
    month = datetime.now().month
    coords = CITY_COORDS.get(city)
    is_monsoon = month in {6, 7, 8, 9}

    if coords is None:
        return 0.45 if is_monsoon else 0.3

    latitude, _ = coords
    coastal_factor = 0.12 if latitude < 20 else 0.05
    monsoon_factor = 0.18 if is_monsoon else 0.05
    return clamp(0.18 + coastal_factor + monsoon_factor, 0.2, 0.8)


def segment_experience_score(segment: tuple[str, str], distance: float) -> float:
    seed = sum(ord(ch) for ch in f"{segment[0]}:{segment[1]}")
    route_factor = (seed % 20) / 100
    distance_factor = min(distance / 1600, 1.0) * 0.35
    return clamp(0.25 + route_factor + distance_factor, 0.2, 0.9)


def risk_label(score: float) -> str:
    if score < 0.3:
        return "Low"
    if score < 0.7:
        return "Medium"
    return "High"


def generate_reason(traffic: float, weather: float, experience: float, distance: float) -> str:
    reasons: list[str] = []
    if weather >= 0.62:
        reasons.append("adverse weather on route")
    if traffic >= 0.7:
        reasons.append("high traffic congestion")
    if experience >= 0.65:
        reasons.append("historical delay trend on this corridor")
    if distance > 1200:
        reasons.append("long distance route")
    return ", ".join(reasons) if reasons else "balanced overall conditions"


def generate_suggestion(traffic: float, weather: float, experience: float) -> str:
    if weather > 0.7:
        return "Monitor weather conditions closely and keep alternate stops ready"
    if traffic > 0.7:
        return "Avoid peak city-entry windows where possible"
    if experience > 0.65:
        return "Plan additional buffer time due to historical delay trend"
    return "Route conditions look stable, proceed with normal monitoring"


def route_points(route_cities: list[str]) -> list[dict[str, Any]]:
    points: list[dict[str, Any]] = []
    for city in route_cities:
        coords = CITY_COORDS.get(city)
        points.append(
            {
                "city": city,
                "lat": coords[0] if coords else None,
                "lng": coords[1] if coords else None,
            }
        )
    return points


def calculate_route_score(route: list[str]) -> tuple[float, float, float, float, float]:
    traffic_scores: list[float] = []
    weather_scores: list[float] = []
    experience_scores: list[float] = []
    total_distance = 0.0
    traffic_baseline = base_traffic_score()

    for i, city in enumerate(route):
        traffic_scores.append(traffic_baseline)
        weather_scores.append(baseline_weather_score(city))

        if i < len(route) - 1:
            segment = (route[i], route[i + 1])
            segment_distance = distance_map.get(segment, 120.0)
            total_distance += segment_distance
            experience_scores.append(segment_experience_score(segment, segment_distance))

    distance_score = min(total_distance / 2000, 1)
    traffic_score = max(traffic_scores) if traffic_scores else traffic_baseline
    weather_score = max(weather_scores) if weather_scores else DEFAULT_WEATHER_FALLBACK
    experience_score = max(experience_scores) if experience_scores else 0.5

    final_score = traffic_score * 0.3 + weather_score * 0.25 + distance_score * 0.2 + experience_score * 0.25
    return round(final_score, 3), total_distance, traffic_score, weather_score, experience_score


def live_weather_score(city: str) -> tuple[float, dict[str, Any]]:
    cached = LIVE_WEATHER_CACHE.get(city)
    if cached and cache_is_fresh(cached[0]):
        return cached[1], cached[2]

    coords = CITY_COORDS.get(city)
    if coords is None:
        payload = {"city": city, "source": "fallback", "summary": "Coordinates unavailable"}
        LIVE_WEATHER_CACHE[city] = (datetime.utcnow(), DEFAULT_WEATHER_FALLBACK, payload)
        return DEFAULT_WEATHER_FALLBACK, payload

    lat, lng = coords
    query = parse.urlencode(
        {
            "latitude": lat,
            "longitude": lng,
            "current": "precipitation,weather_code,wind_speed_10m,temperature_2m",
            "timezone": "auto",
        }
    )
    payload = fetch_json(f"https://api.open-meteo.com/v1/forecast?{query}")
    if payload is None:
        fallback_payload = {"city": city, "source": "fallback", "summary": "Weather API unavailable"}
        LIVE_WEATHER_CACHE[city] = (datetime.utcnow(), DEFAULT_WEATHER_FALLBACK, fallback_payload)
        return DEFAULT_WEATHER_FALLBACK, fallback_payload

    current = payload.get("current", {})
    precipitation = float(current.get("precipitation", 0.0))
    wind_speed = float(current.get("wind_speed_10m", 0.0))
    weather_code = int(current.get("weather_code", 0))
    temperature = current.get("temperature_2m")

    score = 0.16
    if precipitation > 0.2:
        score += 0.22
    if precipitation > 2:
        score += 0.16
    if wind_speed > 30:
        score += 0.2
    if weather_code in {95, 96, 99}:
        score += 0.3
    if weather_code in {61, 63, 65, 80, 81, 82}:
        score += 0.2

    weather_payload = {
        "city": city,
        "source": "open-meteo",
        "precipitation_mm": precipitation,
        "wind_speed_kmph": wind_speed,
        "weather_code": weather_code,
        "temperature_c": temperature,
    }
    weather_score = clamp(score, 0.1, 1.0)
    LIVE_WEATHER_CACHE[city] = (datetime.utcnow(), weather_score, weather_payload)
    return weather_score, weather_payload


def live_traffic_score(city: str) -> tuple[float, dict[str, Any]]:
    cached = LIVE_TRAFFIC_CACHE.get(city)
    if cached and cache_is_fresh(cached[0]):
        return cached[1], cached[2]

    coords = CITY_COORDS.get(city)
    if coords is None:
        fallback = base_traffic_score()
        payload = {"city": city, "source": "fallback", "summary": "Coordinates unavailable"}
        LIVE_TRAFFIC_CACHE[city] = (datetime.utcnow(), fallback, payload)
        return fallback, payload

    api_key = os.getenv("TOMTOM_API_KEY")
    if not api_key:
        fallback = base_traffic_score()
        payload = {"city": city, "source": "fallback", "summary": "TOMTOM_API_KEY not configured"}
        LIVE_TRAFFIC_CACHE[city] = (datetime.utcnow(), fallback, payload)
        return fallback, payload

    lat, lng = coords
    query = parse.urlencode(
        {
            "point": f"{lat},{lng}",
            "unit": "KMPH",
            "key": api_key,
        }
    )
    url = f"https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/10/json?{query}"
    payload = fetch_json(url)

    if payload is None:
        fallback = base_traffic_score()
        fallback_payload = {"city": city, "source": "fallback", "summary": "TomTom API unavailable"}
        LIVE_TRAFFIC_CACHE[city] = (datetime.utcnow(), fallback, fallback_payload)
        return fallback, fallback_payload

    flow = payload.get("flowSegmentData", {})
    current_speed = float(flow.get("currentSpeed", 0.0))
    free_flow_speed = float(flow.get("freeFlowSpeed", 0.0))
    confidence = float(flow.get("confidence", 0.0))

    if free_flow_speed <= 0:
        fallback = base_traffic_score()
        fallback_payload = {"city": city, "source": "fallback", "summary": "Invalid speed payload"}
        LIVE_TRAFFIC_CACHE[city] = (datetime.utcnow(), fallback, fallback_payload)
        return fallback, fallback_payload

    congestion = clamp(1.0 - (current_speed / free_flow_speed), 0.0, 1.0)
    risk = clamp(0.22 + congestion * 0.78, 0.1, 1.0)

    traffic_payload = {
        "city": city,
        "source": "tomtom",
        "current_speed_kmph": current_speed,
        "free_flow_speed_kmph": free_flow_speed,
        "confidence": confidence,
        "congestion_ratio": round(congestion, 3),
    }
    LIVE_TRAFFIC_CACHE[city] = (datetime.utcnow(), risk, traffic_payload)
    return risk, traffic_payload


def infer_alert_type(matched_keywords: list[str]) -> str:
    lowered = set(matched_keywords)
    if lowered & {
        "bandh",
        "bhandh",
        "harthal",
        "hartal",
        "shutdown",
        "strike",
        "protest",
        "protests",
        "procession",
        "processions",
        "demonstration",
        "demonstrations",
        "rally",
        "blockade",
        "road block",
        "road closure",
        "road closed",
        "curfew",
        "riot",
        "clash",
        "clashes",
    }:
        return "traffic"
    return "construction"


def fetch_live_news_alerts(route_cities: list[str]) -> tuple[float, list[dict[str, Any]], str]:
    city_terms = [city for city in route_cities[:5] if city]
    if not city_terms:
        return 0.0, [], "none"

    news_cache_key = route_cache_key(city_terms)
    cached = LIVE_NEWS_CACHE.get(news_cache_key)
    if cached and cache_is_fresh(cached[0]):
        return cached[1], cached[2], cached[3]

    keyword_query = " OR ".join(f'"{keyword}"' for keyword in NEWS_KEYWORDS)
    city_query = " OR ".join(f'"{city}"' for city in city_terms)
    combined_query = f"({city_query}) AND ({keyword_query})"

    params = parse.urlencode(
        {
            "query": combined_query,
            "mode": "ArtList",
            "maxrecords": "25",
            "format": "json",
            "sort": "DateDesc",
        }
    )
    url = f"https://api.gdeltproject.org/api/v2/doc/doc?{params}"
    alerts: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    source_tags: list[str] = []

    payload = fetch_json(url, timeout=3.5)
    if payload is not None:
        articles = payload.get("articles", [])
        if isinstance(articles, list):
            for article in articles[:20]:
                if not isinstance(article, dict):
                    continue
                title = str(article.get("title", "")).strip()
                description = str(article.get("seendate", "")).strip()
                url_value = str(article.get("url", "")).strip()
                domain = str(article.get("domain", "")).strip()

                searchable = f"{title} {description}".lower()
                matched = [keyword for keyword in NEWS_KEYWORDS if keyword in searchable]
                if not matched or not url_value or url_value in seen_urls:
                    continue

                seen_urls.add(url_value)
                severity = "high" if any(keyword in HIGH_IMPACT_NEWS_KEYWORDS for keyword in matched) else "medium"
                alerts.append(
                    {
                        "type": infer_alert_type(matched),
                        "severity": severity,
                        "title": title or "Route-related disruption signal",
                        "description": title,
                        "url": url_value,
                        "source": domain or "gdelt",
                        "matched_keywords": matched,
                        "reported_at": str(article.get("seendate", "")),
                    }
                )
            source_tags.append("gdelt")

    news_api_key = os.getenv("NEWSAPI_KEY")
    if news_api_key:
        news_params = parse.urlencode(
            {
                "q": combined_query,
                "language": "en",
                "sortBy": "publishedAt",
                "pageSize": "20",
                "apiKey": news_api_key,
            }
        )
        news_payload = fetch_json(f"https://newsapi.org/v2/everything?{news_params}", timeout=3.5)
        if news_payload is not None:
            news_articles = news_payload.get("articles", [])
            if isinstance(news_articles, list):
                for article in news_articles[:20]:
                    if not isinstance(article, dict):
                        continue
                    title = str(article.get("title", "")).strip()
                    description = str(article.get("description", "")).strip()
                    url_value = str(article.get("url", "")).strip()
                    source = article.get("source")
                    source_name = source.get("name") if isinstance(source, dict) else ""

                    searchable = f"{title} {description}".lower()
                    matched = [keyword for keyword in NEWS_KEYWORDS if keyword in searchable]
                    if not matched or not url_value or url_value in seen_urls:
                        continue

                    seen_urls.add(url_value)
                    severity = "high" if any(keyword in HIGH_IMPACT_NEWS_KEYWORDS for keyword in matched) else "medium"
                    alerts.append(
                        {
                            "type": infer_alert_type(matched),
                            "severity": severity,
                            "title": title or "Route-related disruption signal",
                            "description": description or title,
                            "url": url_value,
                            "source": source_name or "newsapi",
                            "matched_keywords": matched,
                            "reported_at": str(article.get("publishedAt", "")),
                        }
                    )
                source_tags.append("newsapi")

    high_impact_hits = sum(
        1 for alert in alerts if any(keyword in HIGH_IMPACT_NEWS_KEYWORDS for keyword in alert["matched_keywords"])
    )
    risk = clamp(len(alerts) * 0.08 + high_impact_hits * 0.12, 0.0, 0.85)
    source_label = "+".join(source_tags) if source_tags else "none"
    news_risk = round(risk, 3)
    trimmed_alerts = alerts[:6]
    LIVE_NEWS_CACHE[news_cache_key] = (datetime.utcnow(), news_risk, trimmed_alerts, source_label)
    return news_risk, trimmed_alerts, source_label


def compute_live_intelligence(route_cities: list[str], include_news: bool = True) -> dict[str, Any]:
    cache_key = f"{route_cache_key(route_cities)}|news:{1 if include_news else 0}"
    cached = LIVE_ROUTE_INTEL_CACHE.get(cache_key)
    if cached and cache_is_fresh(cached[0]):
        return cached[1]

    sampled_cities = route_cities if len(route_cities) <= 4 else [route_cities[0], route_cities[1], route_cities[-2], route_cities[-1]]

    weather_scores: list[float] = []
    weather_points: list[dict[str, Any]] = []
    for city in sampled_cities:
        score, payload = live_weather_score(city)
        weather_scores.append(score)
        weather_points.append({**payload, "risk": score})

    traffic_scores: list[float] = []
    traffic_points: list[dict[str, Any]] = []
    for city in sampled_cities:
        score, payload = live_traffic_score(city)
        traffic_scores.append(score)
        traffic_points.append({**payload, "risk": score})

    if include_news:
        news_risk, news_alerts, news_source = fetch_live_news_alerts(route_cities)
    else:
        news_risk, news_alerts, news_source = 0.0, [], "disabled"

    weather_risk = round(max(weather_scores) if weather_scores else DEFAULT_WEATHER_FALLBACK, 3)
    traffic_risk = round(max(traffic_scores) if traffic_scores else base_traffic_score(), 3)
    combined = round(clamp(weather_risk * 0.44 + traffic_risk * 0.46 + news_risk * 0.1, 0.1, 1.0), 3)

    sources = ["open-meteo"]
    if include_news:
        sources.append("gdelt")
    if os.getenv("TOMTOM_API_KEY"):
        sources.append("tomtom")

    summary_bits = [
        f"weather risk {int(weather_risk * 100)}%",
        f"traffic risk {int(traffic_risk * 100)}%",
    ]
    if news_alerts:
        summary_bits.append(f"{len(news_alerts)} disruption-news signals")

    result = {
        "weather_risk": weather_risk,
        "traffic_risk": traffic_risk,
        "news_risk": news_risk,
        "combined_dynamic_risk": combined,
        "weather_points": weather_points,
        "traffic_points": traffic_points,
        "news_alerts": news_alerts,
        "news_source": news_source,
        "summary": ", ".join(summary_bits),
        "sources": sources,
    }
    LIVE_ROUTE_INTEL_CACHE[cache_key] = (datetime.utcnow(), result)
    return result


def tomtom_traffic_tile_template() -> str | None:
    api_key = os.getenv("TOMTOM_API_KEY")
    if not api_key:
        return None
    return f"https://api.tomtom.com/traffic/map/4/tile/flow/relative/{{z}}/{{x}}/{{y}}.png?key={api_key}"


def build_predict_response(request: RouteRequest, persist_analysis: bool = True) -> dict[str, Any]:
    origin = request.origin
    destination = request.destination

    direct = find_route(origin, destination)
    all_routes: dict[str, list[str]] = {"Route 1": direct}

    alt_count = 2
    for mid in graph.get(origin, []):
        if mid != destination and mid not in direct:
            alt_route = find_route(mid, destination)
            if alt_route[-1] == destination:
                all_routes[f"Route {alt_count}"] = [origin] + alt_route
                alt_count += 1
        if alt_count > 3:
            break

    route_results: list[dict[str, Any]] = []
    for route_name, route_cities in all_routes.items():
        score, distance, traffic, weather, experience = calculate_route_score(route_cities)

        if model is not None and hasattr(model, "predict_proba"):
            features = [[distance, traffic, weather, experience]]
            ml_prob = float(model.predict_proba(features)[0][1])
        else:
            ml_prob = score

        final_score = round((score + ml_prob) / 2, 3)
        route_results.append(
            {
                "route_id": route_name,
                "cities": route_cities,
                "city_points": route_points(route_cities),
                "risk_score": final_score,
                "risk_level": risk_label(final_score),
                "reason": generate_reason(traffic, weather, experience, distance),
                "suggestion": generate_suggestion(traffic, weather, experience),
                "distance_km": distance,
            }
        )

    best = min(route_results, key=lambda candidate: candidate["risk_score"])

    response = {
        "origin": origin,
        "destination": destination,
        "routes": route_results,
        "recommended_route": best["route_id"],
        "recommended_cities": best["cities"],
        "reason": best["reason"],
        "suggestion": best["suggestion"],
    }

    if persist_analysis:
        try:
            save_trip_analysis(
                origin=origin,
                destination=destination,
                recommended_route=best["route_id"],
                recommended_risk_level=best["risk_level"],
                recommended_risk_score=best["risk_score"],
                reason=best["reason"],
                suggestion=best["suggestion"],
                routes=route_results,
            )
        except Exception:
            pass

    return response


def city_coords_or_default(city: str, fallback_index: int = 0) -> tuple[float, float]:
    coords = CITY_COORDS.get(city)
    if coords:
        return coords
    return (22.0 + fallback_index * 0.2, 78.0 + fallback_index * 0.2)


def build_stops_for_cities(route_cities: list[str], departure: datetime) -> list[dict[str, Any]]:
    stops: list[dict[str, Any]] = []
    for index, city in enumerate(route_cities):
        lat, lng = city_coords_or_default(city, index)
        eta = departure + timedelta(hours=index * 3)
        stop_type = "stop"
        if index == 0:
            stop_type = "origin"
        elif index == len(route_cities) - 1:
            stop_type = "destination"

        stops.append(
            {
                "name": city,
                "lat": lat,
                "lng": lng,
                "type": stop_type,
                "estimatedArrival": eta.strftime("%H:%M"),
            }
        )
    return stops


def generate_seed_shipments() -> list[dict[str, Any]]:
    valid_pairs: list[tuple[str, str]] = []
    seen_pairs: set[tuple[str, str]] = set()

    for row in rows:
        origin = row["Origin"]
        destination = row["Destination"]
        pair = (origin, destination)
        if pair in seen_pairs or origin == destination:
            continue
        if origin not in CITY_COORDS or destination not in CITY_COORDS:
            continue
        seen_pairs.add(pair)
        valid_pairs.append(pair)
        if len(valid_pairs) >= 8:
            break

    driver_cycle = ["d1", "d2", "d3", "d1", "d2", "d3", None, None]
    status_cycle = ["scheduled", "in_transit", "delayed", "rerouted", "scheduled", "in_transit", "scheduled", "scheduled"]
    cargo_cycle = ["Electronics", "Pharmaceuticals", "FMCG Goods", "Industrial Parts", "Textiles", "Food Products"]
    priority_cycle = ["normal", "express", "critical", "normal", "express", "normal"]
    weight_cycle = ["1,000 kg", "2,200 kg", "850 kg", "3,500 kg", "1,700 kg", "2,900 kg"]

    shipments: list[dict[str, Any]] = []
    for index, pair in enumerate(valid_pairs[:6]):
        origin, destination = pair
        route_cities = find_route(origin, destination)
        departure = datetime.now().replace(minute=0, second=0, microsecond=0) + timedelta(hours=index)
        base_distance = sum(distance_map.get((route_cities[i], route_cities[i + 1]), 120.0) for i in range(len(route_cities) - 1))
        duration_hours = max(4, int(base_distance / 52))
        eta = departure + timedelta(hours=duration_hours)
        shipment_id = f"SHP{index + 1:03d}"
        tracking = f"RG-{datetime.now().year}-{(index + 1):06d}"
        driver_id = driver_cycle[index] if index < len(driver_cycle) else None

        shipment = {
            "id": shipment_id,
            "trackingNumber": tracking,
            "origin": origin,
            "destination": destination,
            "stops": build_stops_for_cities(route_cities, departure),
            "transportMode": "truck",
            "risk_score": 0.5,
            "risk_level": "Medium",
            "reason": "Waiting for live route intelligence...",
            "suggestion": "Run live analysis for weather, traffic, and news disruptions.",
            "assignedDriver": None,
            "driverId": driver_id,
            "scheduledDeparture": departure.isoformat(),
            "estimatedDelivery": eta.isoformat(),
            "status": status_cycle[index % len(status_cycle)],
            "obstructions": [],
            "cargoType": cargo_cycle[index % len(cargo_cycle)],
            "weight": weight_cycle[index % len(weight_cycle)],
            "priority": priority_cycle[index % len(priority_cycle)],
        }

        if shipment["status"] == "delayed":
            shipment["optimizedRoute"] = {
                "stops": shipment["stops"],
                "method": "delayed",
                "delayHours": 6,
                "newEstimatedDelivery": (eta + timedelta(hours=6)).isoformat(),
            }
        elif shipment["status"] == "rerouted":
            shipment["optimizedRoute"] = {
                "stops": shipment["stops"],
                "method": "rerouted",
                "newEstimatedDelivery": (eta + timedelta(hours=2)).isoformat(),
            }

        shipments.append(shipment)

    return shipments


def seed_application_store() -> None:
    counts = app_store_counts()
    if counts["users"] == 0:
        upsert_app_user({"id": "m1", "name": "Rajesh Kumar", "email": "manager@routeguard.com", "role": "manager", "password": "manager123"})
        upsert_app_user({"id": "d1", "name": "Amit Singh", "email": "amit@routeguard.com", "role": "driver", "password": "driver123"})
        upsert_app_user({"id": "d2", "name": "Priya Sharma", "email": "priya@routeguard.com", "role": "driver", "password": "driver123"})
        upsert_app_user({"id": "d3", "name": "Vikram Patel", "email": "vikram@routeguard.com", "role": "driver", "password": "driver123"})

    if counts["drivers"] == 0:
        upsert_app_driver(
            {
                "id": "d1",
                "name": "Amit Singh",
                "phone": "+91 98765 43210",
                "email": "amit@routeguard.com",
                "vehicle_number": "MH-12-AB-1234",
                "current_location": "Mumbai",
                "status": "on_route",
            }
        )
        upsert_app_driver(
            {
                "id": "d2",
                "name": "Priya Sharma",
                "phone": "+91 98765 43211",
                "email": "priya@routeguard.com",
                "vehicle_number": "TN-01-CD-5678",
                "current_location": "Chennai",
                "status": "available",
            }
        )
        upsert_app_driver(
            {
                "id": "d3",
                "name": "Vikram Patel",
                "phone": "+91 98765 43212",
                "email": "vikram@routeguard.com",
                "vehicle_number": "GJ-05-EF-9012",
                "current_location": "Ahmedabad",
                "status": "on_route",
            }
        )

    if counts["shipments"] == 0:
        for shipment in generate_seed_shipments():
            upsert_app_shipment(shipment)


def extract_shipment_route_cities(shipment: dict[str, Any]) -> list[str]:
    stops = shipment.get("stops")
    if isinstance(stops, list):
        names = [
            str(stop.get("name", "")).strip()
            for stop in stops
            if isinstance(stop, dict) and str(stop.get("name", "")).strip()
        ]
        if len(names) >= 2:
            return names

    origin = str(shipment.get("origin", "")).strip()
    destination = str(shipment.get("destination", "")).strip()
    if origin and destination and origin != destination:
        return [origin, destination]
    if origin:
        return [origin]
    return []


def normalize_disruption_type(raw_type: str) -> str:
    normalized = raw_type.strip().lower().replace("-", "_").replace(" ", "_")
    allowed = {"flood", "construction", "fog", "cyclone", "traffic", "bridge_closed", "landslide"}
    if normalized in allowed:
        return normalized
    if normalized in {
        "protest",
        "protests",
        "procession",
        "processions",
        "bandh",
        "hartal",
        "harthal",
        "bhandh",
        "rally",
        "road_block",
        "road_closure",
        "road_closed",
        "blockade",
        "shutdown",
    }:
        return "traffic"
    return "traffic"


def normalize_disruption_severity(raw_severity: str) -> str:
    normalized = raw_severity.strip().lower()
    if normalized in {"low", "medium", "high"}:
        return normalized
    return "medium"


def build_driver_report_obstructions(shipment: dict[str, Any]) -> list[dict[str, Any]]:
    shipment_id = str(shipment.get("id", "")).strip()
    if not shipment_id:
        return []

    reports = list_app_driver_reports(shipment_id=shipment_id, active_only=True)
    fallback_stop = shipment.get("stops", [{}])[0] if isinstance(shipment.get("stops"), list) else {}
    default_location = f"{shipment.get('origin', 'Route')} -> {shipment.get('destination', 'Route')}"
    report_obstructions: list[dict[str, Any]] = []

    for report in reports:
        report_obstructions.append(
            {
                "id": f"driver-report-{report.get('id')}",
                "type": normalize_disruption_type(str(report.get("disruption_type", "traffic"))),
                "location": str(report.get("location") or default_location),
                "lat": fallback_stop.get("lat", 22.0),
                "lng": fallback_stop.get("lng", 78.0),
                "severity": normalize_disruption_severity(str(report.get("severity", "medium"))),
                "description": str(report.get("description") or "Driver-reported disruption"),
                "reportedAt": str(report.get("created_at") or datetime.now().isoformat()),
                "active": bool(report.get("active", 1)),
            }
        )
    return report_obstructions


def merge_obstructions(primary: list[dict[str, Any]], secondary: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()

    for obstruction in primary + secondary:
        if not isinstance(obstruction, dict):
            continue
        obstruction_id = str(obstruction.get("id", "")).strip()
        if obstruction_id and obstruction_id in seen:
            continue
        if obstruction_id:
            seen.add(obstruction_id)
        merged.append(obstruction)

    return merged


def apply_live_intelligence_to_shipment(shipment: dict[str, Any]) -> dict[str, Any]:
    route_cities = extract_shipment_route_cities(shipment)
    if len(route_cities) < 2:
        return shipment

    driver_report_obstructions = build_driver_report_obstructions(shipment)

    last_updated_raw = shipment.get("liveInsightUpdatedAt")
    if isinstance(last_updated_raw, str):
        try:
            normalized = last_updated_raw.replace("Z", "+00:00")
            last_updated = datetime.fromisoformat(normalized)
            if last_updated.tzinfo is not None:
                last_updated = last_updated.astimezone().replace(tzinfo=None)
            if (datetime.now() - last_updated).total_seconds() <= LIVE_CACHE_TTL_SECONDS:
                existing_obstructions = shipment.get("obstructions", [])
                if isinstance(existing_obstructions, list):
                    existing_without_driver_reports = [
                        obstruction
                        for obstruction in existing_obstructions
                        if not str(obstruction.get("id", "")).startswith("driver-report-")
                    ]
                    return {
                        **shipment,
                        "obstructions": merge_obstructions(existing_without_driver_reports, driver_report_obstructions),
                    }
                return {
                    **shipment,
                    "obstructions": driver_report_obstructions,
                }
        except Exception:
            pass

    shipment_status = str(shipment.get("status", "scheduled")).lower()
    include_news = shipment_status != "delivered"
    shipment_live_cities = route_cities if len(route_cities) <= 2 else [route_cities[0], route_cities[-1]]
    intelligence = compute_live_intelligence(shipment_live_cities, include_news=include_news)
    if not isinstance(intelligence, dict):
        return shipment

    base_risk = float(shipment.get("risk_score", 0.5))
    live_adjusted = round(
        clamp(
            base_risk * 0.62
            + float(intelligence.get("weather_risk", DEFAULT_WEATHER_FALLBACK)) * 0.16
            + float(intelligence.get("traffic_risk", base_traffic_score())) * 0.18
            + float(intelligence.get("news_risk", 0.0)) * 0.04
        ),
        3,
    )

    news_alerts = intelligence.get("news_alerts", [])
    obstructions: list[dict[str, Any]] = []
    fallback_stop = shipment.get("stops", [{}])[0] if isinstance(shipment.get("stops"), list) else {}
    for index, alert in enumerate(news_alerts if isinstance(news_alerts, list) else []):
        if not isinstance(alert, dict):
            continue
        obstructions.append(
            {
                "id": alert.get("id") or f"{shipment.get('id', 'SHP')}-AL{index + 1}",
                "type": alert.get("type", "traffic"),
                "location": alert.get("location", f"{shipment.get('origin')} -> {shipment.get('destination')}"),
                "lat": fallback_stop.get("lat", 22.0),
                "lng": fallback_stop.get("lng", 78.0),
                "severity": alert.get("severity", "medium"),
                "description": alert.get("description", "Live route disruption detected"),
                "reportedAt": alert.get("reported_at", datetime.now().isoformat()),
                "active": True,
            }
        )

    combined_obstructions = merge_obstructions(obstructions, driver_report_obstructions)
    severity_boost = {
        "low": 0.03,
        "medium": 0.07,
        "high": 0.12,
    }
    manual_boost = sum(
        severity_boost.get(str(obstruction.get("severity", "medium")).lower(), 0.05)
        for obstruction in driver_report_obstructions
    )
    adjusted_with_reports = round(clamp(live_adjusted + min(manual_boost, 0.2)), 3)

    existing_reason = str(shipment.get("reason", "")).strip()
    summary = str(intelligence.get("summary", "")).strip()
    merged_reason = existing_reason
    if summary and summary not in existing_reason:
        merged_reason = f"{existing_reason}; {summary}" if existing_reason else summary
    if driver_report_obstructions:
        report_note = f"{len(driver_report_obstructions)} driver-reported disruption(s) on route"
        if report_note not in merged_reason:
            merged_reason = f"{merged_reason}; {report_note}" if merged_reason else report_note

    existing_suggestion = str(shipment.get("suggestion", "")).strip()
    merged_suggestion = existing_suggestion or "Monitor live weather, traffic, and disruption news before dispatch."
    if driver_report_obstructions and "driver report" not in merged_suggestion.lower():
        merged_suggestion = f"{merged_suggestion}. Review driver reports and reroute if needed."

    merged = {
        **shipment,
        "risk_score": adjusted_with_reports,
        "risk_level": risk_label(adjusted_with_reports),
        "reason": merged_reason,
        "suggestion": merged_suggestion,
        "obstructions": combined_obstructions,
        "liveInsightUpdatedAt": datetime.now().isoformat(),
    }
    return merged


def list_shipments_with_live_risk(driver_id: str | None = None) -> list[dict[str, Any]]:
    shipments = list_app_shipments(driver_id=driver_id)
    hydrated: list[dict[str, Any]] = []
    for shipment in shipments:
        try:
            updated = apply_live_intelligence_to_shipment(shipment)
        except Exception:
            updated = shipment
        hydrated.append(updated)
        try:
            upsert_app_shipment(updated)
        except Exception:
            pass
    return hydrated


seed_application_store()


@app.get("/")
def health_check() -> dict[str, str]:
    return {"status": "ok", "message": "Route risk backend is running"}


@app.post("/auth/login")
def login(request: LoginRequest) -> dict[str, Any]:
    user = get_app_user_by_credentials(request.email, request.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return user


@app.get("/drivers")
def get_drivers() -> dict[str, Any]:
    drivers = list_app_drivers()
    shipments = list_app_shipments()
    assignments: dict[str, list[str]] = {}
    for shipment in shipments:
        driver_id = shipment.get("driverId")
        if isinstance(driver_id, str):
            assignments.setdefault(driver_id, []).append(str(shipment.get("id", "")))

    normalized = [
        {
            "id": driver["id"],
            "name": driver["name"],
            "phone": driver["phone"],
            "email": driver["email"],
            "vehicleNumber": driver["vehicle_number"],
            "currentLocation": driver.get("current_location"),
            "status": driver["status"],
            "assignedShipments": assignments.get(driver["id"], []),
        }
        for driver in drivers
    ]
    return {"drivers": normalized}


@app.get("/shipments")
def get_shipments(driver_id: str | None = None) -> dict[str, Any]:
    return {"shipments": list_shipments_with_live_risk(driver_id=driver_id)}


@app.post("/shipments/assign-driver")
def assign_driver(request: AssignDriverRequest) -> dict[str, Any]:
    shipment = get_app_shipment(request.shipment_id)
    if shipment is None:
        raise HTTPException(status_code=404, detail="Shipment not found")

    drivers = list_app_drivers()
    driver = next((entry for entry in drivers if entry["id"] == request.driver_id), None)
    if driver is None:
        raise HTTPException(status_code=404, detail="Driver not found")

    updated = {
        **shipment,
        "driverId": request.driver_id,
        "assignedDriver": driver["name"],
    }
    upsert_app_shipment(updated)
    return {"shipment": apply_live_intelligence_to_shipment(updated)}


@app.post("/shipments/report-disruption")
def report_shipment_disruption(request: DriverDisruptionReportRequest) -> dict[str, Any]:
    shipment = get_app_shipment(request.shipment_id)
    if shipment is None:
        raise HTTPException(status_code=404, detail="Shipment not found")

    assigned_driver = shipment.get("driverId")
    if isinstance(assigned_driver, str) and assigned_driver and assigned_driver != request.driver_id:
        raise HTTPException(status_code=403, detail="Driver is not assigned to this shipment")

    report = create_app_driver_report(
        {
            "shipment_id": request.shipment_id,
            "driver_id": request.driver_id,
            "disruption_type": normalize_disruption_type(request.disruption_type),
            "severity": normalize_disruption_severity(request.severity),
            "location": request.location.strip() or f"{shipment.get('origin')} -> {shipment.get('destination')}",
            "description": request.description.strip() or "Driver-reported disruption",
            "active": True,
        }
    )

    mutable_shipment = {
        **shipment,
        "liveInsightUpdatedAt": "",
    }
    updated_shipment = apply_live_intelligence_to_shipment(mutable_shipment)
    upsert_app_shipment(updated_shipment)
    return {"shipment": updated_shipment, "report": report}


@app.post("/shipments/delay")
def delay_shipment(request: DelayShipmentRequest) -> dict[str, Any]:
    shipment = get_app_shipment(request.shipment_id)
    if shipment is None:
        raise HTTPException(status_code=404, detail="Shipment not found")

    delay_hours = max(1, int(request.delay_hours))
    base_eta_value = shipment.get("optimizedRoute", {}).get("newEstimatedDelivery") if isinstance(shipment.get("optimizedRoute"), dict) else None
    base_eta = base_eta_value if isinstance(base_eta_value, str) else shipment.get("estimatedDelivery", datetime.now().isoformat())
    try:
        eta_dt = datetime.fromisoformat(str(base_eta))
    except Exception:
        eta_dt = datetime.now()
    new_eta = eta_dt + timedelta(hours=delay_hours)

    updated = {
        **shipment,
        "status": "delayed",
        "reason": request.note or f"Delay requested for {delay_hours} hour(s)",
        "suggestion": "Delay acknowledged. Monitor live weather, traffic, and disruption news before release.",
        "optimizedRoute": {
            "stops": shipment.get("stops", []),
            "method": "delayed",
            "delayHours": delay_hours,
            "newEstimatedDelivery": new_eta.isoformat(),
        },
    }
    upsert_app_shipment(updated)
    return {"shipment": apply_live_intelligence_to_shipment(updated)}


@app.post("/shipments/from-analysis")
def add_shipment_from_analysis(request: AddShipmentFromAnalysisRequest) -> dict[str, Any]:
    route = request.route
    cities_in_route = route.get("cities", [request.origin, request.destination])
    if not isinstance(cities_in_route, list) or len(cities_in_route) < 2:
        cities_in_route = [request.origin, request.destination]

    shipment_id = f"SHP{str(int(datetime.now().timestamp()))[-6:]}"
    departure = datetime.now().replace(second=0, microsecond=0)
    distance = float(route.get("distance_km", 420))
    eta = departure + timedelta(hours=max(4, int(distance / 52)))
    stops = build_stops_for_cities([str(city) for city in cities_in_route], departure)

    shipment = {
        "id": shipment_id,
        "trackingNumber": f"RG-{datetime.now().year}-{shipment_id[-6:]}",
        "origin": request.origin,
        "destination": request.destination,
        "stops": stops,
        "transportMode": "truck",
        "risk_score": float(route.get("risk_score", 0.5)),
        "risk_level": str(route.get("risk_level", "Medium")),
        "reason": str(route.get("reason", "Route added from analyzed result.")),
        "suggestion": str(route.get("suggestion", "Track live map intelligence before dispatch.")),
        "scheduledDeparture": departure.isoformat(),
        "estimatedDelivery": eta.isoformat(),
        "status": "scheduled",
        "obstructions": [],
        "cargoType": "General Cargo",
        "weight": "1,000 kg",
        "priority": "normal",
    }
    upsert_app_shipment(shipment)
    return {"shipment": apply_live_intelligence_to_shipment(shipment)}


@app.post("/predict")
def predict(request: RouteRequest) -> dict[str, Any]:
    return build_predict_response(request)


@app.post("/predict/")
def predict_with_slash(request: RouteRequest) -> dict[str, Any]:
    return build_predict_response(request)


def build_live_map_insight_response(request: RouteRequest, persist_analysis: bool = True) -> dict[str, Any]:
    prediction = build_predict_response(request, persist_analysis=persist_analysis)
    updated_routes: list[dict[str, Any]] = []

    for route in prediction["routes"]:
        intelligence = compute_live_intelligence(route["cities"])
        live_adjusted = round(
            clamp(
                route["risk_score"] * 0.62
                + intelligence["weather_risk"] * 0.16
                + intelligence["traffic_risk"] * 0.18
                + intelligence["news_risk"] * 0.04
            ),
            3,
        )

        live_alerts: list[dict[str, Any]] = []
        for alert in intelligence["news_alerts"]:
            live_alerts.append(
                {
                    "id": f"news-{abs(hash((alert['url'], route['route_id']))) % 100000}",
                    "type": alert["type"],
                    "severity": alert["severity"],
                    "location": " / ".join(route["cities"][:2]),
                    "description": alert["title"],
                    "reported_at": alert["reported_at"],
                    "url": alert["url"],
                    "source": alert["source"],
                }
            )

        updated_routes.append(
            {
                **route,
                "risk_score": live_adjusted,
                "risk_level": risk_label(live_adjusted),
                "live_weather_risk": intelligence["weather_risk"],
                "live_traffic_risk": intelligence["traffic_risk"],
                "live_news_risk": intelligence["news_risk"],
                "live_dynamic_risk": intelligence["combined_dynamic_risk"],
                "live_summary": intelligence["summary"],
                "live_weather_points": intelligence["weather_points"],
                "live_traffic_points": intelligence["traffic_points"],
                "live_news_alerts": intelligence["news_alerts"],
                "live_alerts": live_alerts,
            }
        )

    best = min(updated_routes, key=lambda candidate: candidate["risk_score"])

    return {
        **prediction,
        "routes": updated_routes,
        "recommended_route": best["route_id"],
        "recommended_cities": best["cities"],
        "reason": best["reason"],
        "suggestion": best["suggestion"],
        "live_weather_risk": best.get("live_weather_risk", DEFAULT_WEATHER_FALLBACK),
        "live_traffic_risk": best.get("live_traffic_risk", base_traffic_score()),
        "live_news_risk": best.get("live_news_risk", 0.0),
        "live_news_alerts": best.get("live_news_alerts", []),
        "live_alerts": best.get("live_alerts", []),
        "traffic_tile_template": tomtom_traffic_tile_template(),
        "insight_source": "open-meteo + tomtom + gdelt + route-risk-model",
    }


@app.post("/live-map-insight")
def live_map_insight(request: RouteRequest) -> dict[str, Any]:
    return build_live_map_insight_response(request, persist_analysis=True)


@app.get("/cities")
def get_cities() -> dict[str, list[str]]:
    return {"cities": sorted(cities)}


@app.get("/cities/")
def get_cities_with_slash() -> dict[str, list[str]]:
    return get_cities()


@app.get("/city-coordinates")
def get_city_coordinates() -> dict[str, Any]:
    return {
        "cities": sorted(cities),
        "coordinates": {
            city: {"lat": coords[0], "lng": coords[1]}
            for city, coords in CITY_COORDS.items()
        },
    }
