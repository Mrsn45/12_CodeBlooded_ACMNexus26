"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Obstruction, Shipment } from "@/lib/route-data";
import { getShipments, reportDriverDisruption } from "@/lib/backend-api";
import { DetailedRouteMap } from "./detailed-route-map";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Bell, ChevronRight, Clock, Flag, LogOut, MapPin, Navigation, Package, Radar, Truck } from "lucide-react";

const TransportIcon = Truck;

export function DriverDashboard() {
  const { user, logout } = useAuth();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
  const [alerts, setAlerts] = useState<Obstruction[]>([]);
  const [isLoadingShipments, setIsLoadingShipments] = useState(true);
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false);
  const [reportType, setReportType] = useState("traffic");
  const [reportSeverity, setReportSeverity] = useState<"low" | "medium" | "high">("medium");
  const [reportLocation, setReportLocation] = useState("");
  const [reportDescription, setReportDescription] = useState("");
  const [reportError, setReportError] = useState("");
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);

  useEffect(() => {
    let mounted = true;
    const loadDriverShipments = async () => {
      if (!user) {
        setShipments([]);
        setSelectedShipment(null);
        setAlerts([]);
        setIsLoadingShipments(false);
        return;
      }
      setIsLoadingShipments(true);
      try {
        const backendShipments = await getShipments(user.id);
        if (!mounted) return;
        setShipments(backendShipments);
        setSelectedShipment((previous) => previous ? backendShipments.find((shipment) => shipment.id === previous.id) || backendShipments[0] || null : backendShipments[0] || null);
      } catch {
        if (mounted) {
          setShipments([]);
          setSelectedShipment(null);
        }
      } finally {
        if (mounted) {
          setIsLoadingShipments(false);
        }
      }
    };
    loadDriverShipments();
    return () => {
      mounted = false;
    };
  }, [user]);

  useEffect(() => {
    setAlerts(shipments.flatMap((shipment) => shipment.obstructions).filter((obstruction) => obstruction.active));
  }, [shipments]);

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

  const handleOpenReportDialog = () => {
    if (!selectedShipment) return;
    setReportType("traffic");
    setReportSeverity("medium");
    setReportLocation(`${selectedShipment.origin} -> ${selectedShipment.destination}`);
    setReportDescription("");
    setReportError("");
    setIsReportDialogOpen(true);
  };

  const handleReportDisruption = async () => {
    if (!selectedShipment || !user) return;
    if (!reportLocation.trim()) {
      setReportError("Please enter disruption location.");
      return;
    }
    if (!reportDescription.trim()) {
      setReportError("Please describe the disruption.");
      return;
    }

    setIsSubmittingReport(true);
    setReportError("");
    try {
      const updatedShipment = await reportDriverDisruption(
        selectedShipment.id,
        user.id,
        reportType,
        reportSeverity,
        reportLocation.trim(),
        reportDescription.trim()
      );
      setShipments((previous) => previous.map((shipment) => shipment.id === updatedShipment.id ? updatedShipment : shipment));
      setSelectedShipment(updatedShipment);
      setIsReportDialogOpen(false);
    } catch {
      setReportError("Could not submit report right now. Please try again.");
    } finally {
      setIsSubmittingReport(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-4 md:px-6">
          <div className="hidden sm:block">
            <div className="w-fit rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-primary">Driver Board</div>
          </div>
          <BrandMark compact className="justify-self-center" />
          <div className="flex items-center justify-self-end gap-2">
            {alerts.length > 0 && <div className="relative rounded-full border border-destructive/20 bg-destructive/10 p-2"><Bell className="h-4 w-4 text-destructive" /><span className="absolute -right-1 -top-1 rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-destructive-foreground">{alerts.length}</span></div>}
            <ThemeToggle />
            <div className="hidden text-right sm:block"><p className="text-sm font-semibold text-foreground">{user?.name}</p><p className="text-xs text-muted-foreground">Driver</p></div>
            <Button variant="outline" size="icon" className="border-border bg-card/70" onClick={logout}><LogOut className="h-4 w-4" /></Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6">
        <section className="hero-band app-panel p-5 md:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.28em] text-primary">Driver Workspace</p>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">Structured route guidance before the live map</h1>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">Check your assigned route, review timing and risk, then open the map with the same readable theme and route intelligence cards.</p>
            </div>
            {selectedShipment && (
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={getStatusColor(selectedShipment.status)}>{selectedShipment.status.replace("_", " ")}</Badge>
                <Badge variant="outline" className={getRiskColor(selectedShipment.risk_level)}>{selectedShipment.risk_level} risk</Badge>
              </div>
            )}
          </div>
        </section>

        {alerts.length > 0 && (
          <section className="app-panel border-destructive/20 bg-destructive/10 p-4">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <h2 className="font-semibold text-foreground">Critical Alerts</h2>
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              {alerts.slice(0, 3).map((alert) => (
                <div key={alert.id} className="rounded-xl border border-destructive/20 bg-card/90 p-3 text-xs">
                  <p className="font-semibold uppercase text-destructive">{alert.type.replace("_", " ")}</p>
                  <p className="mt-1 text-foreground">{alert.location}</p>
                  <p className="mt-1 text-muted-foreground">{alert.description}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {selectedShipment ? (
          <DetailedRouteMap shipment={selectedShipment} view="driver" />
        ) : (
          <Card className="app-panel">
            <CardContent className="py-12 text-center">
              <Navigation className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Select a route to view the live map.</p>
            </CardContent>
          </Card>
        )}

        <section className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-5">
            <Card className="app-panel">
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-foreground">My Route Queue</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {isLoadingShipments ? (
                  <div className="app-panel-muted p-8 text-center"><Navigation className="mx-auto mb-2 h-6 w-6 animate-pulse text-primary" /><p className="text-sm text-muted-foreground">Loading assigned routes...</p></div>
                ) : shipments.length === 0 ? (
                  <div className="app-panel-muted p-8 text-center"><Package className="mx-auto mb-2 h-6 w-6 text-muted-foreground" /><p className="text-sm text-muted-foreground">No routes assigned.</p></div>
                ) : (
                  shipments.map((shipment) => {
                    const isSelected = selectedShipment?.id === shipment.id;
                    return (
                      <button key={shipment.id} className={`w-full rounded-2xl border p-4 text-left transition ${isSelected ? "border-primary/50 bg-primary/10" : "border-border/80 bg-secondary/25 hover:border-primary/30"}`} onClick={() => setSelectedShipment(shipment)}>
                        <div className="mb-2 flex items-center justify-between">
                          <div className="flex items-center gap-2"><div className="rounded-xl border border-border/70 bg-card/90 p-2"><TransportIcon className="h-4 w-4 text-primary" /></div><span className="text-xs font-mono text-muted-foreground">{shipment.trackingNumber}</span></div>
                          <Badge className={getStatusColor(shipment.status)}>{shipment.status.replace("_", " ")}</Badge>
                        </div>
                        <div className="mb-2 flex items-center gap-2 text-sm text-foreground">
                          <MapPin className="h-3.5 w-3.5 text-success" />
                          <span>{shipment.origin}</span>
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                          <MapPin className="h-3.5 w-3.5 text-destructive" />
                          <span>{shipment.destination}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="inline-flex items-center gap-1 text-muted-foreground"><Clock className="h-3 w-3" />ETA: {formatDate(shipment.optimizedRoute?.newEstimatedDelivery || shipment.estimatedDelivery)}</span>
                          <span className={`font-semibold ${getRiskColor(shipment.risk_level)}`}>{Math.round(shipment.risk_score * 100)}%</span>
                        </div>
                      </button>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4 lg:col-span-7">
            {selectedShipment ? (
              <Card className="app-panel">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base text-foreground">Delivery Intelligence</CardTitle>
                    <Badge className={getStatusColor(selectedShipment.status)}>{selectedShipment.status.replace("_", " ")}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="app-panel-muted p-3"><p className="text-xs text-muted-foreground">Departure</p><p className="mt-1 text-sm font-medium text-foreground">{formatDate(selectedShipment.scheduledDeparture)}</p></div>
                    <div className="app-panel-muted p-3"><p className="text-xs text-muted-foreground">Predicted Delivery</p><p className="mt-1 text-sm font-medium text-foreground">{formatDate(selectedShipment.optimizedRoute?.newEstimatedDelivery || selectedShipment.estimatedDelivery)}</p></div>
                    <div className="app-panel-muted p-3"><p className="text-xs text-muted-foreground">Cargo</p><p className="mt-1 text-sm font-medium text-foreground">{selectedShipment.cargoType} ({selectedShipment.weight})</p></div>
                    <div className="app-panel-muted p-3"><p className="text-xs text-muted-foreground">Priority</p><p className="mt-1 text-sm font-medium capitalize text-foreground">{selectedShipment.priority}</p></div>
                  </div>
                  <div className="rounded-xl border border-border/80 bg-secondary/25 p-4 text-sm">
                    <div className="flex items-center gap-2"><Radar className="h-4 w-4 text-primary" /><p className="font-medium text-foreground">AI Route Guidance</p></div>
                    <p className="mt-2 text-muted-foreground">{selectedShipment.reason}</p>
                    <p className="mt-2 text-success">Suggestion: {selectedShipment.suggestion}</p>
                  </div>
                  <Button className="w-full bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleOpenReportDialog}>
                    <Flag className="mr-2 h-4 w-4" />
                    Report Sudden Disruption
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card className="app-panel">
                <CardContent className="py-16 text-center"><Navigation className="mx-auto mb-2 h-8 w-8 text-muted-foreground" /><p className="text-sm text-muted-foreground">Select a route to view details.</p></CardContent>
              </Card>
            )}
          </div>
        </section>
      </main>

      <Dialog open={isReportDialogOpen} onOpenChange={setIsReportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report Road Disruption</DialogTitle>
            <DialogDescription>
              Submit sudden on-route issues like protest, bandh, procession, roadblock, or accident.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="report-type">Disruption Type</Label>
                <Select value={reportType} onValueChange={setReportType}>
                  <SelectTrigger id="report-type" className="bg-secondary/40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="traffic">Traffic Jam</SelectItem>
                    <SelectItem value="protest">Protest</SelectItem>
                    <SelectItem value="procession">Procession</SelectItem>
                    <SelectItem value="bandh">Bandh</SelectItem>
                    <SelectItem value="hartal">Hartal</SelectItem>
                    <SelectItem value="road_block">Road Block</SelectItem>
                    <SelectItem value="construction">Construction</SelectItem>
                    <SelectItem value="flood">Flooding</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="report-severity">Severity</Label>
                <Select value={reportSeverity} onValueChange={(value) => setReportSeverity(value as "low" | "medium" | "high")}>
                  <SelectTrigger id="report-severity" className="bg-secondary/40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="report-location">Location</Label>
              <Input id="report-location" value={reportLocation} onChange={(event) => setReportLocation(event.target.value)} placeholder="Enter exact location" className="bg-secondary/40" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="report-description">Description</Label>
              <Textarea id="report-description" value={reportDescription} onChange={(event) => setReportDescription(event.target.value)} placeholder="Describe what happened" className="bg-secondary/40" />
            </div>

            {reportError && <p className="text-sm text-destructive">{reportError}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsReportDialogOpen(false)} disabled={isSubmittingReport}>Cancel</Button>
            <Button className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleReportDisruption} disabled={isSubmittingReport}>
              {isSubmittingReport ? "Submitting..." : "Submit Report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
