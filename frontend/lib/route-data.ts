export type TransportMode = "truck";
export type RiskLevel = "Low" | "Medium" | "High" | "Critical";
export type UserRole = "manager" | "driver";

export interface RouteStop {
  name: string;
  lat: number;
  lng: number;
  type: "origin" | "stop" | "destination";
  estimatedArrival?: string;
}

export interface Obstruction {
  id: string;
  type: "flood" | "construction" | "fog" | "cyclone" | "traffic" | "bridge_closed" | "landslide";
  location: string;
  lat: number;
  lng: number;
  severity: "low" | "medium" | "high";
  description: string;
  reportedAt: string;
  active: boolean;
}

export interface Shipment {
  id: string;
  trackingNumber: string;
  origin: string;
  destination: string;
  stops: RouteStop[];
  transportMode: TransportMode;
  risk_score: number;
  risk_level: RiskLevel;
  reason: string;
  suggestion: string;
  assignedDriver?: string;
  driverId?: string;
  scheduledDeparture: string;
  estimatedDelivery: string;
  actualDelivery?: string;
  status: "scheduled" | "in_transit" | "delayed" | "rerouted" | "delivered";
  obstructions: Obstruction[];
  optimizedRoute?: {
    stops: RouteStop[];
    method: "rerouted" | "delayed" | "mode_change";
    newMode?: TransportMode;
    delayHours?: number;
    newEstimatedDelivery: string;
  };
  cargoType: string;
  weight: string;
  priority: "normal" | "express" | "critical";
}

export interface Driver {
  id: string;
  name: string;
  phone: string;
  email: string;
  vehicleNumber: string;
  currentLocation?: string;
  status: "available" | "on_route" | "break";
  assignedShipments: string[];
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export function getTransportModeIcon(mode: TransportMode): string {
  return mode === "truck" ? "Truck" : "Truck";
}
