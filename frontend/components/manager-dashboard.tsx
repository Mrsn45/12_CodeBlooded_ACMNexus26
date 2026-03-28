"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Driver, Shipment, Obstruction } from "@/lib/route-data";
import {
  addShipmentFromAnalysis,
  analyzeRoute,
  assignShipmentDriver,
  BackendPredictResponse,
  BackendRoute,
  delayShipment as delayShipmentInBackend,
  getAvailableCities,
  getCityCoordinates,
  getDrivers,
  getShipments,
} from "@/lib/backend-api";
import { DetailedRouteMap } from "./detailed-route-map";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Activity, AlertTriangle, ArrowRight, BarChart3, Bell, Clock, LogOut, MapPin, Package, Radar, RefreshCw, Route, Timer, TrendingUp, Truck, Users } from "lucide-react";

const TransportIcon = Truck;

export function ManagerDashboard() {
  const { user, logout } = useAuth();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [driverOptions, setDriverOptions] = useState<Driver[]>([]);
  const [alertShipments, setAlertShipments] = useState<Shipment[]>([]);
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
  const [allObstructions, setAllObstructions] = useState<Obstruction[]>([]);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [filter, setFilter] = useState<"all" | "action_needed" | "in_transit" | "delayed">("all");
  const [isLoadingShipments, setIsLoadingShipments] = useState(true);
  const [cityOptions, setCityOptions] = useState<string[]>([]);
  const [analysisOrigin, setAnalysisOrigin] = useState("");
  const [analysisDestination, setAnalysisDestination] = useState("");
  const [analysisResult, setAnalysisResult] = useState<BackendPredictResponse | null>(null);
  const [selectedAnalyzedRouteId, setSelectedAnalyzedRouteId] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [cityCoordinateMap, setCityCoordinateMap] = useState<Record<string, { lat: number; lng: number }>>({});
  const [isDelayDialogOpen, setIsDelayDialogOpen] = useState(false);
  const [delayHoursInput, setDelayHoursInput] = useState("6");
  const [delayNote, setDelayNote] = useState("");
  const [delayError, setDelayError] = useState("");

  useEffect(() => {
    let mounted = true;
    const loadShipments = async () => {
      setIsLoadingShipments(true);
      try {
        const enrichedShipments = await getShipments();
        if (!mounted) return;
        setShipments(enrichedShipments);
        setSelectedShipment((previous) =>
          previous
            ? enrichedShipments.find((shipment) => shipment.id === previous.id) || enrichedShipments[0] || null
            : enrichedShipments[0] || null
        );
      } catch {
        if (mounted) {
          setShipments([]);
          setSelectedShipment(null);
          setAnalysisError("Could not load shipments from backend");
        }
      } finally {
        if (mounted) setIsLoadingShipments(false);
      }
    };
    loadShipments();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    setAlertShipments(shipments.filter((shipment) => shipment.risk_level === "High" || shipment.risk_level === "Critical"));
    setAllObstructions(shipments.flatMap((shipment) => shipment.obstructions).filter((obstruction) => obstruction.active));
  }, [shipments]);

  useEffect(() => {
    let mounted = true;
    const loadCities = async () => {
      try {
        const [cities, coordinates, backendDrivers] = await Promise.all([
          getAvailableCities(),
          getCityCoordinates(),
          getDrivers(),
        ]);
        if (!mounted) return;
        setCityOptions(cities);
        setCityCoordinateMap(coordinates);
        setDriverOptions(backendDrivers);
        if (cities.length > 1) {
          setAnalysisOrigin(cities[0]);
          setAnalysisDestination(cities[1]);
        }
      } catch {
        if (mounted) setAnalysisError("Could not load city list from backend");
      }
    };
    loadCities();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  const getStatusColor = (status: Shipment["status"]) => ({
    scheduled: "bg-accent text-accent-foreground",
    in_transit: "bg-success text-success-foreground",
    delayed: "bg-warning text-warning-foreground",
    rerouted: "bg-primary text-primary-foreground",
    delivered: "bg-muted text-muted-foreground",
  }[status]);

  const getRiskColor = (level: Shipment["risk_level"]) => ({
    Low: "text-success",
    Medium: "text-accent",
    High: "text-primary",
    Critical: "text-destructive",
  }[level]);

  const filteredShipments = shipments.filter((shipment) => {
    if (filter === "all") return true;
    if (filter === "action_needed") return shipment.risk_level === "High" || shipment.risk_level === "Critical";
    if (filter === "in_transit") return shipment.status === "in_transit";
    if (filter === "delayed") return shipment.status === "delayed";
    return true;
  });

  const stats = useMemo(() => ({
    total: shipments.length,
    inTransit: shipments.filter((shipment) => shipment.status === "in_transit").length,
    delayed: shipments.filter((shipment) => shipment.status === "delayed").length,
    needsAction: alertShipments.length,
  }), [alertShipments.length, shipments]);

  const handleAssignDriver = async (shipmentId: string, driverId: string) => {
    try {
      const updatedShipment = await assignShipmentDriver(shipmentId, driverId);
      setShipments((previous) => previous.map((shipment) => shipment.id === shipmentId ? updatedShipment : shipment));
      setSelectedShipment((previous) => previous && previous.id === shipmentId ? updatedShipment : previous);
    } catch {
      setAnalysisError("Failed to assign driver. Please try again.");
    }
  };

  const handleAnalyzeRoute = async () => {
    if (!analysisOrigin || !analysisDestination) return setAnalysisError("Select both origin and destination");
    if (analysisOrigin === analysisDestination) return setAnalysisError("Origin and destination must be different");
    setIsAnalyzing(true);
    setAnalysisError("");
    try {
      const result = await analyzeRoute(analysisOrigin, analysisDestination);
      setAnalysisResult(result);
      setSelectedAnalyzedRouteId(result.recommended_route);
    } catch {
      setAnalysisError("Route analysis failed. Check backend and try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDelayShipment = () => {
    if (!selectedShipment) return;
    const parsedDelay = Number(delayHoursInput);
    if (!Number.isFinite(parsedDelay) || parsedDelay <= 0) return setDelayError("Enter a valid delay in hours");

    delayShipmentInBackend(selectedShipment.id, parsedDelay, delayNote)
      .then((updatedShipment) => {
        setShipments((previous) => previous.map((shipment) => shipment.id === updatedShipment.id ? updatedShipment : shipment));
        setSelectedShipment(updatedShipment);
        setDelayError("");
        setDelayNote("");
        setDelayHoursInput("6");
        setIsDelayDialogOpen(false);
      })
      .catch(() => {
        setDelayError("Could not apply delay. Try again.");
      });
  };

  const handleAddAnalyzedRoute = () => {
    if (!analyzedRoute) {
      return;
    }
    addShipmentFromAnalysis(analysisOrigin, analysisDestination, analyzedRoute)
      .then((newShipment) => {
        setShipments((previous) => [newShipment, ...previous]);
        setSelectedShipment(newShipment);
        setFilter("all");
      })
      .catch(() => {
        setAnalysisError("Could not add analyzed route right now.");
      });
  };

  const analyzedRoute: BackendRoute | null = analysisResult?.routes.find((route) => route.route_id === selectedAnalyzedRouteId) || analysisResult?.routes[0] || null;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-4 md:px-6">
          <div className="hidden sm:block">
            <div className="w-fit rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-primary">Manager Console</div>
          </div>
          <BrandMark compact className="justify-self-center" />
          <div className="flex items-center justify-self-end gap-2">
            {allObstructions.length > 0 && <div className="relative rounded-full border border-destructive/20 bg-destructive/10 p-2"><Bell className="h-4 w-4 text-destructive" /><span className="absolute -right-1 -top-1 rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-destructive-foreground">{allObstructions.length}</span></div>}
            <ThemeToggle />
            <div className="hidden text-right sm:block"><p className="text-sm font-semibold text-foreground">{user?.name}</p><p className="text-xs text-muted-foreground">Manager</p></div>
            <Button variant="outline" size="icon" className="border-border bg-card/70" onClick={logout}><LogOut className="h-4 w-4" /></Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:px-6">
        <section className="hero-band app-panel p-5 md:p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.28em] text-primary">Control Center</p>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">Route-first logistics operations</h1>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">Analyze routes, choose the best option, then open the detailed map and operational controls without text blending into the background.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 xl:w-[34rem]">
              <div className="app-panel-muted p-3"><p className="text-xs text-muted-foreground">Live Sync</p><p className="mt-2 text-sm font-semibold text-foreground">{currentTime.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p></div>
              <div className="app-panel-muted p-3"><p className="text-xs text-muted-foreground">Open Alerts</p><p className="mt-2 text-sm font-semibold text-foreground">{allObstructions.length} active issues</p></div>
              <div className="app-panel-muted p-3"><p className="text-xs text-muted-foreground">Selected Route</p><p className="mt-2 text-sm font-semibold text-foreground">{selectedShipment ? `${selectedShipment.origin} to ${selectedShipment.destination}` : "No route selected"}</p></div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card className="metric-card"><CardContent className="p-0"><div className="flex items-center justify-between"><div><p className="text-xs text-muted-foreground">Total Shipments</p><p className="mt-2 text-3xl font-semibold text-foreground">{stats.total}</p></div><Package className="h-7 w-7 text-primary" /></div></CardContent></Card>
          <Card className="metric-card"><CardContent className="p-0"><div className="flex items-center justify-between"><div><p className="text-xs text-muted-foreground">In Transit</p><p className="mt-2 text-3xl font-semibold text-success">{stats.inTransit}</p></div><TrendingUp className="h-7 w-7 text-success" /></div></CardContent></Card>
          <Card className="metric-card"><CardContent className="p-0"><div className="flex items-center justify-between"><div><p className="text-xs text-muted-foreground">Delayed</p><p className="mt-2 text-3xl font-semibold text-foreground">{stats.delayed}</p></div><Timer className="h-7 w-7 text-accent" /></div></CardContent></Card>
          <Card className="metric-card"><CardContent className="p-0"><div className="flex items-center justify-between"><div><p className="text-xs text-muted-foreground">Needs Action</p><p className="mt-2 text-3xl font-semibold text-destructive">{stats.needsAction}</p></div><AlertTriangle className="h-7 w-7 text-destructive" /></div></CardContent></Card>
        </section>

        <section className="grid gap-6 xl:grid-cols-12">
          <div className="space-y-6 xl:col-span-7">
            <Card className="app-panel">
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <CardTitle className="flex items-center gap-2 text-base text-foreground"><Route className="h-4 w-4 text-primary" />Analyze New Route</CardTitle>
                  <p className="text-xs text-muted-foreground">Trip analyses are stored automatically in SQLite.</p>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="analysis-origin" className="text-xs text-muted-foreground">Origin</Label>
                    <Select value={analysisOrigin} onValueChange={setAnalysisOrigin}>
                      <SelectTrigger id="analysis-origin" className="border-border bg-secondary/40"><SelectValue placeholder="Select origin" /></SelectTrigger>
                      <SelectContent>{cityOptions.map((city) => <SelectItem key={`origin-${city}`} value={city}>{city}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="analysis-destination" className="text-xs text-muted-foreground">Destination</Label>
                    <Select value={analysisDestination} onValueChange={setAnalysisDestination}>
                      <SelectTrigger id="analysis-destination" className="border-border bg-secondary/40"><SelectValue placeholder="Select destination" /></SelectTrigger>
                      <SelectContent>{cityOptions.map((city) => <SelectItem key={`destination-${city}`} value={city}>{city}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>

                <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleAnalyzeRoute} disabled={isAnalyzing || cityOptions.length === 0}>
                  {isAnalyzing ? "Analyzing..." : "Analyze Route"}
                </Button>

                {analysisError && <p className="text-xs text-destructive">{analysisError}</p>}

                {analysisResult && analyzedRoute && (
                  <div className="grid gap-4 rounded-2xl border border-border/80 bg-secondary/25 p-4 lg:grid-cols-[0.9fr_1.1fr]">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-foreground">Route options</p>
                        <Badge className="bg-primary text-primary-foreground">Best: {analysisResult.recommended_route}</Badge>
                      </div>
                      <Select value={selectedAnalyzedRouteId} onValueChange={setSelectedAnalyzedRouteId}>
                        <SelectTrigger className="border-border bg-background/80"><SelectValue placeholder="Select analyzed route" /></SelectTrigger>
                        <SelectContent>
                          {analysisResult.routes.map((route) => (
                            <SelectItem key={route.route_id} value={route.route_id}>
                              {route.route_id} - {Math.round(route.risk_score * 100)}% ({route.risk_level})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="space-y-2">
                        {analysisResult.routes.map((route) => {
                          const isActive = route.route_id === selectedAnalyzedRouteId;
                          return (
                            <button key={route.route_id} type="button" onClick={() => setSelectedAnalyzedRouteId(route.route_id)} className={`w-full rounded-xl border p-3 text-left transition ${isActive ? "border-primary/50 bg-primary/10" : "border-border/70 bg-background/70 hover:border-primary/30"}`}>
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-sm font-medium text-foreground">{route.route_id}</p>
                                <Badge variant="outline" className={getRiskColor(route.risk_level as Shipment["risk_level"])}>{route.risk_level}</Badge>
                              </div>
                              <p className="mt-2 text-xs text-muted-foreground">{route.cities.join(" -> ")}</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-3 rounded-xl border border-border/80 bg-card/90 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs text-muted-foreground">Selected analysis</p>
                          <p className="mt-1 text-lg font-semibold text-foreground">{analysisOrigin}{" -> "}{analysisDestination}</p>
                        </div>
                        <Badge className="bg-accent text-accent-foreground">{Math.round(analyzedRoute.risk_score * 100)}%</Badge>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="app-panel-muted p-3"><p className="text-xs text-muted-foreground">Risk</p><p className={`mt-1 text-sm font-semibold ${getRiskColor(analyzedRoute.risk_level as Shipment["risk_level"])}`}>{analyzedRoute.risk_level}</p></div>
                        <div className="app-panel-muted p-3"><p className="text-xs text-muted-foreground">Distance</p><p className="mt-1 text-sm font-semibold text-foreground">{Math.round(analyzedRoute.distance_km)} km</p></div>
                      </div>
                      <div className="space-y-2 text-sm">
                        <p className="text-foreground"><span className="font-medium">Cities:</span> {analyzedRoute.cities.join(" -> ")}</p>
                        <p className="text-muted-foreground"><span className="font-medium text-foreground">Reason:</span> {analyzedRoute.reason}</p>
                        <p className="text-success"><span className="font-medium text-foreground">Suggestion:</span> {analyzedRoute.suggestion}</p>
                      </div>
                      <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleAddAnalyzedRoute}>
                        Add To Routes
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {selectedShipment && (
              <Card className="app-panel">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base text-foreground"><BarChart3 className="h-4 w-4 text-primary" />Route Visualization</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="app-panel-muted p-3"><p className="text-xs text-muted-foreground">Current Shipment</p><p className="mt-1 font-medium text-foreground">{selectedShipment.origin}{" -> "}{selectedShipment.destination}</p></div>
                    <div className="app-panel-muted p-3"><p className="text-xs text-muted-foreground">ETA</p><p className="mt-1 font-medium text-foreground">{formatDate(selectedShipment.optimizedRoute?.newEstimatedDelivery || selectedShipment.estimatedDelivery)}</p></div>
                    <div className="app-panel-muted p-3"><p className="text-xs text-muted-foreground">Risk Status</p><p className={`mt-1 font-semibold ${getRiskColor(selectedShipment.risk_level)}`}>{selectedShipment.risk_level} ({Math.round(selectedShipment.risk_score * 100)}%)</p></div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <DetailedRouteMap shipment={selectedShipment} view="before" />
                    <DetailedRouteMap shipment={selectedShipment} view="after" />
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="app-panel">
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle className="text-base text-foreground">Shipment Routes</CardTitle>
                  <Select value={filter} onValueChange={(value: typeof filter) => setFilter(value)}>
                    <SelectTrigger className="w-[170px] border-border bg-secondary/40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Shipments</SelectItem>
                      <SelectItem value="action_needed">Needs Action</SelectItem>
                      <SelectItem value="in_transit">In Transit</SelectItem>
                      <SelectItem value="delayed">Delayed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {isLoadingShipments && filteredShipments.length === 0 ? (
                  <div className="app-panel-muted p-8 text-center"><RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin text-primary" /><p className="text-sm text-muted-foreground">Loading route predictions...</p></div>
                ) : (
                  filteredShipments.map((shipment) => {
                    const isSelected = selectedShipment?.id === shipment.id;
                    return (
                      <button key={shipment.id} onClick={() => setSelectedShipment(shipment)} className={`w-full rounded-2xl border p-4 text-left transition ${isSelected ? "border-primary/50 bg-primary/10" : "border-border/80 bg-secondary/25 hover:border-primary/30"}`}>
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="rounded-xl border border-border/70 bg-card/90 p-2"><TransportIcon className="h-4 w-4 text-primary" /></div>
                              <span className="text-xs font-mono text-muted-foreground">{shipment.trackingNumber}</span>
                              <Badge className={getStatusColor(shipment.status)}>{shipment.status.replace("_", " ")}</Badge>
                              <span className={`text-xs font-semibold ${getRiskColor(shipment.risk_level)}`}>{Math.round(shipment.risk_score * 100)}% risk</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                              <MapPin className="h-3.5 w-3.5 text-success" />
                              <span>{shipment.origin}</span>
                              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                              <MapPin className="h-3.5 w-3.5 text-destructive" />
                              <span>{shipment.destination}</span>
                            </div>
                            <p className="line-clamp-2 text-xs text-muted-foreground">{shipment.reason}</p>
                          </div>
                          <div className="space-y-1 text-xs text-muted-foreground lg:text-right">
                            <p className="inline-flex items-center gap-1 lg:justify-end"><Users className="h-3 w-3" />{shipment.assignedDriver || "Unassigned"}</p>
                            <p className="inline-flex items-center gap-1 lg:justify-end"><Clock className="h-3 w-3" />ETA: {formatDate(shipment.optimizedRoute?.newEstimatedDelivery || shipment.estimatedDelivery)}</p>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>

          <aside className="space-y-6 xl:col-span-5">
            {selectedShipment && (
              <Card className="app-panel">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base text-foreground"><Activity className="h-4 w-4 text-primary" />Shipment Controls</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="app-panel-muted p-4">
                    <p className="text-xs text-muted-foreground">Tracking Number</p>
                    <p className="mt-1 font-mono text-sm text-foreground">{selectedShipment.trackingNumber}</p>
                    <p className="mt-2 text-xs text-muted-foreground">{selectedShipment.origin}{" -> "}{selectedShipment.destination}</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Assign Driver</Label>
                    <Select value={selectedShipment.driverId || ""} onValueChange={(value) => handleAssignDriver(selectedShipment.id, value)}>
                      <SelectTrigger className="border-border bg-secondary/40"><SelectValue placeholder="Select driver" /></SelectTrigger>
                      <SelectContent>{driverOptions.map((driver) => <SelectItem key={driver.id} value={driver.id}>{driver.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" className="bg-accent text-accent-foreground hover:bg-accent/90" onClick={() => { setDelayError(""); setDelayNote(""); setDelayHoursInput(selectedShipment.optimizedRoute?.delayHours?.toString() || "6"); setIsDelayDialogOpen(true); }}><Timer className="mr-1 h-4 w-4" />Delay</Button>
                    <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90"><RefreshCw className="mr-1 h-4 w-4" />Reroute</Button>
                  </div>
                  <div className="rounded-xl border border-border/80 bg-secondary/25 p-4 text-sm">
                    <div className="flex items-center gap-2"><Radar className="h-4 w-4 text-primary" /><p className="font-medium text-foreground">Risk Analysis</p></div>
                    <p className="mt-3 text-muted-foreground">{selectedShipment.reason}</p>
                    <p className="mt-2 text-success">Suggestion: {selectedShipment.suggestion}</p>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="app-panel">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base text-foreground"><Bell className="h-4 w-4 text-destructive" />Live Obstructions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {allObstructions.length === 0 && <p className="app-panel-muted p-3 text-xs text-muted-foreground">No active obstructions.</p>}
                {allObstructions.slice(0, 4).map((obstruction) => (
                  <div key={obstruction.id} className="rounded-xl border border-border/80 bg-secondary/25 p-3 text-xs">
                    <div className="mb-1 flex items-center justify-between"><p className="font-medium capitalize text-foreground">{obstruction.type.replace("_", " ")}</p><Badge variant="outline" className="capitalize">{obstruction.severity}</Badge></div>
                    <p className="text-muted-foreground">{obstruction.location}</p>
                    <p className="mt-1 text-muted-foreground">{obstruction.description}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </aside>
        </section>
      </main>

      <Dialog open={isDelayDialogOpen} onOpenChange={setIsDelayDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule a delay</DialogTitle>
            <DialogDescription>Update the selected shipment with a planned delay window and operations note.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="delay-hours">Delay Hours</Label>
              <Input id="delay-hours" type="number" min="1" value={delayHoursInput} onChange={(event) => setDelayHoursInput(event.target.value)} className="bg-secondary/40" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="delay-note">Delay Note</Label>
              <Textarea id="delay-note" value={delayNote} onChange={(event) => setDelayNote(event.target.value)} placeholder="Explain why this trip is being delayed" className="bg-secondary/40" />
            </div>
            {delayError && <p className="text-sm text-destructive">{delayError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDelayDialogOpen(false)}>Cancel</Button>
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleDelayShipment}>Apply Delay</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
