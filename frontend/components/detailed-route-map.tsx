"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { Shipment, RouteStop } from "@/lib/route-data";
import { BackendLiveAlert, BackendNewsAlert, getLiveMapInsight } from "@/lib/backend-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Clock, CloudRain, Newspaper, Route, TrafficCone, MapPin, Navigation, Radar } from "lucide-react";

const MapContainer: any = dynamic(() => import("react-leaflet").then((mod) => mod.MapContainer), { ssr: false });
const TileLayer: any = dynamic(() => import("react-leaflet").then((mod) => mod.TileLayer), { ssr: false });
const Polyline: any = dynamic(() => import("react-leaflet").then((mod) => mod.Polyline), { ssr: false });
const CircleMarker: any = dynamic(() => import("react-leaflet").then((mod) => mod.CircleMarker), { ssr: false });
const Popup: any = dynamic(() => import("react-leaflet").then((mod) => mod.Popup), { ssr: false });

type ViewMode = "before" | "after" | "driver";

interface DetailedRouteMapProps {
  shipment: Shipment;
  view: ViewMode;
}

interface LiveInsight {
  riskLevel: string;
  riskScore: number;
  reason: string;
  suggestion: string;
  weatherRisk: number;
  trafficRisk: number;
  newsRisk: number;
  weatherSource: string;
  trafficSource: string;
  summary: string;
  alerts: BackendLiveAlert[];
  newsAlerts: BackendNewsAlert[];
  trafficTileTemplate?: string | null;
  updatedAt: Date;
}

function hasCoordinates(value: unknown): value is { lat: number; lng: number; city?: unknown } {
  if (!value || typeof value !== "object") return false;
  const point = value as Record<string, unknown>;
  return typeof point.lat === "number" && typeof point.lng === "number";
}

function buildStopsFromCityPoints(points: Array<Record<string, unknown>> | undefined): RouteStop[] {
  if (!points || points.length < 2) return [];
  const validPoints = points.filter(hasCoordinates);
  if (validPoints.length < 2) return [];

  return validPoints.map((point, index) => ({
    name: typeof point.city === "string" && point.city.trim().length > 0 ? point.city : `Point ${index + 1}`,
    lat: point.lat,
    lng: point.lng,
    type: index === 0 ? "origin" : index === validPoints.length - 1 ? "destination" : "stop",
  }));
}

function areStopsEquivalent(first: RouteStop[], second: RouteStop[]): boolean {
  if (first.length !== second.length) return false;
  return first.every((stop, index) => {
    const other = second[index];
    return Math.abs(stop.lat - other.lat) < 0.0001 && Math.abs(stop.lng - other.lng) < 0.0001;
  });
}

function getMarkerColor(stop: RouteStop): string {
  if (stop.type === "origin") return "#22c55e";
  if (stop.type === "destination") return "#ef4444";
  return "#3b82f6";
}

function getRouteColor(riskLevel: Shipment["risk_level"], view: ViewMode, isOptimized: boolean): string {
  if (view === "driver") return "#2563eb";
  if (isOptimized) return "#0ea5e9";
  if (riskLevel === "Critical" || riskLevel === "High") return "#ef4444";
  if (riskLevel === "Medium") return "#f59e0b";
  return "#22c55e";
}

function getTrafficOverlayFromEnv(): string | null {
  const key = process.env.NEXT_PUBLIC_TOMTOM_API_KEY;
  if (!key) {
    return null;
  }
  return `https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.png?key=${key}`;
}

export function DetailedRouteMap({ shipment, view }: DetailedRouteMapProps) {
  const { resolvedTheme } = useTheme();
  const [insightOptimizedStops, setInsightOptimizedStops] = useState<RouteStop[]>([]);
  const stops = useMemo(() => {
    if (view === "before" || view === "driver") {
      return shipment.stops;
    }

    const localOptimizedStops = shipment.optimizedRoute?.stops || [];
    if (localOptimizedStops.length >= 2 && !areStopsEquivalent(localOptimizedStops, shipment.stops)) {
      return localOptimizedStops;
    }
    if (insightOptimizedStops.length >= 2) {
      return insightOptimizedStops;
    }
    return localOptimizedStops.length >= 2 ? localOptimizedStops : shipment.stops;
  }, [insightOptimizedStops, shipment.optimizedRoute?.stops, shipment.stops, view]);

  const isOptimized = view === "after" && (
    Boolean(shipment.optimizedRoute) ||
    insightOptimizedStops.length >= 2
  );
  const routeColor = getRouteColor(shipment.risk_level, view, isOptimized);

  const routePoints = useMemo(() => stops.map((stop) => [stop.lat, stop.lng] as [number, number]), [stops]);
  const [roadRoutePoints, setRoadRoutePoints] = useState<Array<[number, number]>>([]);

  const mapBounds = useMemo(() => {
    if (routePoints.length === 0) return undefined;
    const lats = routePoints.map((point) => point[0]);
    const lngs = routePoints.map((point) => point[1]);
    return [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ] as [[number, number], [number, number]];
  }, [routePoints]);

  const [liveInsight, setLiveInsight] = useState<LiveInsight | null>(null);
  const [isLoadingInsight, setIsLoadingInsight] = useState(true);

  const mapTiles = resolvedTheme === "dark"
    ? {
      base: "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png",
      labels: "https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png",
    }
    : {
      base: "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png",
      labels: "https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png",
    };

  useEffect(() => {
    let active = true;

    const fetchRoadGeometry = async () => {
      if (routePoints.length < 2) {
        if (active) setRoadRoutePoints(routePoints);
        return;
      }

      const coordinates = routePoints.map((point) => `${point[1]},${point[0]}`).join(";");
      const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson`;

      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error("OSRM routing failed");
        const payload = await response.json();
        const geometry = payload?.routes?.[0]?.geometry?.coordinates as Array<[number, number]> | undefined;
        if (!active || !geometry || geometry.length === 0) return;
        setRoadRoutePoints(geometry.map((point) => [point[1], point[0]] as [number, number]));
      } catch {
        if (active) setRoadRoutePoints(routePoints);
      }
    };

    setRoadRoutePoints(routePoints);
    fetchRoadGeometry();

    return () => {
      active = false;
    };
  }, [routePoints]);

  useEffect(() => {
    let active = true;

    const refreshInsight = async () => {
      try {
        const result = await getLiveMapInsight(shipment.origin, shipment.destination);
        if (!active || result.routes.length === 0) return;

        const recommended = result.routes.find((route) => route.route_id === result.recommended_route) || result.routes[0];
        const recommendedStops = buildStopsFromCityPoints(recommended.city_points as Array<Record<string, unknown>> | undefined);
        if (active) {
          setInsightOptimizedStops(recommendedStops);
        }
        setLiveInsight({
          riskLevel: recommended.risk_level,
          riskScore: recommended.risk_score,
          reason: recommended.reason,
          suggestion: recommended.suggestion,
          weatherRisk: recommended.live_weather_risk ?? result.live_weather_risk ?? 0.35,
          trafficRisk: recommended.live_traffic_risk ?? result.live_traffic_risk ?? 0.4,
          newsRisk: recommended.live_news_risk ?? result.live_news_risk ?? 0,
          weatherSource: String((recommended.live_weather_points?.[0] as Record<string, unknown> | undefined)?.source || "fallback"),
          trafficSource: String((recommended.live_traffic_points?.[0] as Record<string, unknown> | undefined)?.source || "fallback"),
          summary: recommended.live_summary || "Live map intelligence is active.",
          alerts: recommended.live_alerts || result.live_alerts || [],
          newsAlerts: recommended.live_news_alerts || result.live_news_alerts || [],
          trafficTileTemplate: result.traffic_tile_template || getTrafficOverlayFromEnv(),
          updatedAt: new Date(),
        });
      } finally {
        if (active) setIsLoadingInsight(false);
      }
    };

    setIsLoadingInsight(true);
    setInsightOptimizedStops([]);
    refreshInsight();
    const intervalId = setInterval(refreshInsight, 60000);

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [shipment.origin, shipment.destination]);

  const title = view === "driver" ? "Live Driver Route" : view === "before" ? "Live Route Map" : "Optimized Route Map";
  const activePolyline = roadRoutePoints.length > 1 ? roadRoutePoints : routePoints;
  const displayAlerts = useMemo(() => {
    const shipmentAlerts: BackendLiveAlert[] = shipment.obstructions.map((obstruction) => ({
      id: `shipment-${obstruction.id}`,
      type: obstruction.type,
      severity: obstruction.severity,
      location: obstruction.location,
      description: obstruction.description,
      reported_at: obstruction.reportedAt,
      source: "driver-report",
    }));
    const insightAlerts = liveInsight?.alerts || [];
    const merged = [...shipmentAlerts, ...insightAlerts];
    const seen = new Set<string>();
    return merged.filter((alert, index) => {
      const key = `${alert.id || ""}-${alert.description || ""}-${index}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [liveInsight?.alerts, shipment.obstructions]);

  return (
    <Card className="overflow-hidden border-border bg-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base text-foreground">
            <Navigation className="h-4 w-4" />
            {title}
          </CardTitle>
          <Badge className="bg-primary text-primary-foreground">{shipment.risk_level} Risk</Badge>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="h-72 w-full border-b border-t border-border md:h-96">
          {mapBounds ? (
            <MapContainer bounds={mapBounds} boundsOptions={{ padding: [24, 24] }} scrollWheelZoom className="h-full w-full">
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; CARTO'
                url={mapTiles.base}
              />

              {liveInsight?.trafficTileTemplate && (
                <TileLayer
                  attribution="TomTom Traffic"
                  url={liveInsight.trafficTileTemplate}
                  opacity={0.42}
                />
              )}

              <Polyline positions={activePolyline} pathOptions={{ color: "#ffffff", opacity: 0.95, weight: 8 }} />
              <Polyline positions={activePolyline} pathOptions={{ color: routeColor, opacity: 0.95, weight: 5 }} />

              <TileLayer
                attribution="CARTO Labels"
                url={mapTiles.labels}
                opacity={1}
              />

              {stops.map((stop, index) => (
                <CircleMarker
                  key={`${stop.name}-${index}`}
                  center={[stop.lat, stop.lng]}
                  radius={stop.type === "stop" ? 7 : 9}
                  pathOptions={{ color: "#ffffff", weight: 2, fillColor: getMarkerColor(stop), fillOpacity: 1 }}
                >
                  <Popup>
                    <div className="text-sm text-slate-900">
                      <p className="font-semibold">{stop.name}</p>
                      <p className="capitalize text-slate-600">{stop.type}</p>
                      {stop.estimatedArrival && <p>ETA: {stop.estimatedArrival}</p>}
                    </div>
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Route coordinates unavailable</div>
          )}
        </div>

        <div className="space-y-2 bg-secondary/20 p-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {stops.length} stops
              </span>
              {shipment.optimizedRoute?.method === "delayed" && (
                <span className="inline-flex items-center gap-1 text-warning">
                  <Clock className="h-3 w-3" />+{shipment.optimizedRoute.delayHours}h delay
                </span>
              )}
              {view === "before" && shipment.obstructions.length > 0 && (
                <span className="inline-flex items-center gap-1 text-destructive">
                  <AlertTriangle className="h-3 w-3" />
                  {shipment.obstructions.length} obstruction(s)
                </span>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border/80 bg-card/75 p-3 text-xs">
            <div className="mb-2 flex items-center justify-between">
              <p className="inline-flex items-center gap-1 font-medium text-foreground">
                <Radar className="h-3.5 w-3.5 text-primary" />
                Live AI Map Intelligence
              </p>
              <span className="text-muted-foreground">
                {isLoadingInsight
                  ? "Refreshing..."
                  : liveInsight
                    ? `Updated ${liveInsight.updatedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`
                    : "Unavailable"}
              </span>
            </div>

            {liveInsight ? (
              <>
                <p className="text-foreground">Risk: {liveInsight.riskLevel} ({Math.round(liveInsight.riskScore * 100)}%)</p>
                <p className="mt-1 text-muted-foreground">{liveInsight.summary}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border border-border/70 bg-background/70 p-2">
                    <p className="inline-flex items-center gap-1 text-muted-foreground"><CloudRain className="h-3 w-3" />Weather</p>
                    <p className="mt-1 font-semibold text-foreground">{Math.round(liveInsight.weatherRisk * 100)}%</p>
                    <p className="text-[11px] text-muted-foreground">{liveInsight.weatherSource}</p>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-background/70 p-2">
                    <p className="inline-flex items-center gap-1 text-muted-foreground"><TrafficCone className="h-3 w-3" />Traffic</p>
                    <p className="mt-1 font-semibold text-foreground">{Math.round(liveInsight.trafficRisk * 100)}%</p>
                    <p className="text-[11px] text-muted-foreground">{liveInsight.trafficSource}</p>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-background/70 p-2">
                    <p className="inline-flex items-center gap-1 text-muted-foreground"><Newspaper className="h-3 w-3" />News</p>
                    <p className="mt-1 font-semibold text-foreground">{Math.round(liveInsight.newsRisk * 100)}%</p>
                  </div>
                </div>

                {displayAlerts.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    <p className="inline-flex items-center gap-1 font-medium text-foreground"><Route className="h-3.5 w-3.5 text-destructive" />Live route alerts</p>
                    {displayAlerts.slice(0, 3).map((alert, index) => (
                      <div key={`${alert.id || index}`} className="rounded-lg border border-border/70 bg-background/70 p-2">
                        <p className="text-foreground">{alert.description || "Route disruption signal detected."}</p>
                        <p className="text-muted-foreground">{alert.location || "Route corridor"}</p>
                      </div>
                    ))}
                  </div>
                )}

                {liveInsight.newsAlerts.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    <p className="inline-flex items-center gap-1 font-medium text-foreground"><Newspaper className="h-3.5 w-3.5 text-primary" />News AI signals</p>
                    {liveInsight.newsAlerts.slice(0, 2).map((news, index) => (
                      <a
                        key={`${news.url}-${index}`}
                        href={news.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-lg border border-border/70 bg-background/70 p-2 hover:border-primary/40"
                      >
                        <p className="text-foreground">{news.title}</p>
                        <p className="text-muted-foreground">{news.source} {news.matched_keywords.length > 0 ? `- ${news.matched_keywords.join(", ")}` : ""}</p>
                      </a>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">Live weather, traffic, and news intelligence will appear once analysis completes.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
