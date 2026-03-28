import { Driver, Obstruction, Shipment, User } from "@/lib/route-data";

interface BackendCityPoint {
  city: string;
  lat: number | null;
  lng: number | null;
}

interface BackendLiveAlert {
  id?: string;
  type?: string;
  severity?: "low" | "medium" | "high";
  location?: string;
  description?: string;
  reported_at?: string;
  url?: string;
  source?: string;
}

interface BackendNewsAlert {
  type: string;
  severity: "low" | "medium" | "high";
  title: string;
  description: string;
  url: string;
  source: string;
  matched_keywords: string[];
  reported_at: string;
}

interface BackendRoute {
  route_id: string;
  cities: string[];
  city_points?: BackendCityPoint[];
  risk_score: number;
  risk_level: "Low" | "Medium" | "High";
  reason: string;
  suggestion: string;
  distance_km: number;
  live_weather_risk?: number;
  live_traffic_risk?: number;
  live_news_risk?: number;
  live_dynamic_risk?: number;
  live_summary?: string;
  live_weather_points?: Array<Record<string, unknown>>;
  live_traffic_points?: Array<Record<string, unknown>>;
  live_news_alerts?: BackendNewsAlert[];
  live_alerts?: BackendLiveAlert[];
}

interface BackendPredictResponse {
  origin: string;
  destination: string;
  routes: BackendRoute[];
  recommended_route: string;
  recommended_cities: string[];
  reason: string;
  suggestion: string;
  live_weather_risk?: number;
  live_traffic_risk?: number;
  live_news_risk?: number;
  live_news_alerts?: BackendNewsAlert[];
  live_alerts?: BackendLiveAlert[];
  traffic_tile_template?: string | null;
  insight_source?: string;
}

interface BackendCitiesResponse {
  cities: string[];
}

interface BackendCityCoordinatesResponse {
  cities: string[];
  coordinates: Record<string, { lat: number; lng: number }>;
}

interface BackendDriversResponse {
  drivers: Driver[];
}

interface BackendShipmentsResponse {
  shipments: Shipment[];
}

interface BackendShipmentResponse {
  shipment: Shipment;
}

interface BackendReportDisruptionResponse {
  shipment: Shipment;
  report?: Record<string, unknown>;
}

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000";

function getBackendBaseUrl() {
  return (process.env.NEXT_PUBLIC_BACKEND_URL || DEFAULT_BACKEND_URL).replace(/\/$/, "");
}

function normalizeObstructionType(rawType?: string): Obstruction["type"] {
  const value = (rawType || "").toLowerCase();
  if (value === "flood") return "flood";
  if (value === "construction") return "construction";
  if (value === "fog") return "fog";
  if (value === "cyclone") return "cyclone";
  if (value === "traffic") return "traffic";
  if (value === "bridge_closed") return "bridge_closed";
  if (value === "landslide") return "landslide";
  return "traffic";
}

function mapLiveAlertsToObstructions(shipment: Shipment, alerts: BackendLiveAlert[] | undefined): Obstruction[] {
  if (!alerts || alerts.length === 0) {
    return [];
  }

  const fallbackStop = shipment.stops[0];
  return alerts.map((alert, index) => ({
    id: alert.id || `live-${shipment.id}-${index}`,
    type: normalizeObstructionType(alert.type),
    location: alert.location || `${shipment.origin} -> ${shipment.destination}`,
    lat: fallbackStop?.lat || 0,
    lng: fallbackStop?.lng || 0,
    severity: alert.severity || "medium",
    description: alert.description || "Live disruption signal",
    reportedAt: alert.reported_at || new Date().toISOString(),
    active: true,
  }));
}

function mergePredictionIntoShipment(shipment: Shipment, prediction: BackendPredictResponse): Shipment {
  const recommended = prediction.routes.find((route) => route.route_id === prediction.recommended_route) || prediction.routes[0];
  if (!recommended) return shipment;
  const liveObstructions = mapLiveAlertsToObstructions(shipment, recommended.live_alerts || prediction.live_alerts);
  return {
    ...shipment,
    risk_score: recommended.risk_score,
    risk_level: recommended.risk_level,
    reason: recommended.reason,
    suggestion: recommended.suggestion,
    obstructions: liveObstructions,
  };
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${getBackendBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Backend request failed (${path}): ${response.status}`);
  }
  return response.json();
}

export async function loginUser(email: string, password: string): Promise<User | null> {
  try {
    const response = await postJson<User>("/auth/login", { email, password });
    return response;
  } catch {
    return null;
  }
}

export async function getDrivers(): Promise<Driver[]> {
  const response = await fetch(`${getBackendBaseUrl()}/drivers`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Backend drivers failed: ${response.status}`);
  const data = (await response.json()) as BackendDriversResponse;
  return data.drivers || [];
}

export async function getShipments(driverId?: string): Promise<Shipment[]> {
  const query = driverId ? `?driver_id=${encodeURIComponent(driverId)}` : "";
  const response = await fetch(`${getBackendBaseUrl()}/shipments${query}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Backend shipments failed: ${response.status}`);
  const data = (await response.json()) as BackendShipmentsResponse;
  return data.shipments || [];
}

export async function assignShipmentDriver(shipmentId: string, driverId: string): Promise<Shipment> {
  const data = await postJson<BackendShipmentResponse>("/shipments/assign-driver", {
    shipment_id: shipmentId,
    driver_id: driverId,
  });
  return data.shipment;
}

export async function delayShipment(shipmentId: string, delayHours: number, note: string): Promise<Shipment> {
  const data = await postJson<BackendShipmentResponse>("/shipments/delay", {
    shipment_id: shipmentId,
    delay_hours: delayHours,
    note,
  });
  return data.shipment;
}

export async function addShipmentFromAnalysis(origin: string, destination: string, route: BackendRoute): Promise<Shipment> {
  const data = await postJson<BackendShipmentResponse>("/shipments/from-analysis", {
    origin,
    destination,
    route,
  });
  return data.shipment;
}

export async function reportDriverDisruption(
  shipmentId: string,
  driverId: string,
  disruptionType: string,
  severity: "low" | "medium" | "high",
  location: string,
  description: string
): Promise<Shipment> {
  const data = await postJson<BackendReportDisruptionResponse>("/shipments/report-disruption", {
    shipment_id: shipmentId,
    driver_id: driverId,
    disruption_type: disruptionType,
    severity,
    location,
    description,
  });
  return data.shipment;
}

export async function getAvailableCities(): Promise<string[]> {
  const response = await fetch(`${getBackendBaseUrl()}/cities`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Backend cities failed: ${response.status}`);
  const data = (await response.json()) as BackendCitiesResponse;
  return data.cities || [];
}

export async function getCityCoordinates(): Promise<Record<string, { lat: number; lng: number }>> {
  const response = await fetch(`${getBackendBaseUrl()}/city-coordinates`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Backend city coordinates failed: ${response.status}`);
  const data = (await response.json()) as BackendCityCoordinatesResponse;
  return data.coordinates || {};
}

export async function analyzeRoute(origin: string, destination: string): Promise<BackendPredictResponse> {
  return getLiveMapInsight(origin, destination);
}

export async function getPrediction(origin: string, destination: string): Promise<BackendPredictResponse> {
  return postJson<BackendPredictResponse>("/predict", { origin, destination });
}

export async function getLiveMapInsight(origin: string, destination: string): Promise<BackendPredictResponse> {
  return postJson<BackendPredictResponse>("/live-map-insight", { origin, destination });
}

export async function hydrateShipmentsWithBackendRisk(shipments: Shipment[]): Promise<Shipment[]> {
  const merged = await Promise.all(
    shipments.map(async (shipment) => {
      try {
        const prediction = await getLiveMapInsight(shipment.origin, shipment.destination);
        return mergePredictionIntoShipment(shipment, prediction);
      } catch (error) {
        console.warn(`Failed to fetch prediction for ${shipment.origin} -> ${shipment.destination}`, error);
        return shipment;
      }
    })
  );
  return merged;
}

export type { BackendCityPoint, BackendLiveAlert, BackendNewsAlert, BackendPredictResponse, BackendRoute };
