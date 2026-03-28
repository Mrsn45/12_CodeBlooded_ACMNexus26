"use client";

import { useAuth } from "@/lib/auth-context";
import { LoginPage } from "@/components/login-page";
import { DriverDashboard } from "@/components/driver-dashboard";
import { ManagerDashboard } from "@/components/manager-dashboard";
import { Spinner } from "@/components/ui/spinner";

export default function Home() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Spinner className="h-8 w-8 text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  if (user.role === "manager") {
    return <ManagerDashboard />;
  }

  return <DriverDashboard />;
}
