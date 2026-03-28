"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup, Field, FieldLabel } from "@/components/ui/field";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Shield, Truck, Users, AlertCircle, Route, Radar } from "lucide-react";

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    await new Promise((resolve) => setTimeout(resolve, 500));

    const success = await login(email, password);
    if (!success) {
      setError("Invalid email or password");
    }
    setIsLoading(false);
  };

  const handleQuickLogin = (role: "manager" | "driver") => {
    if (role === "manager") {
      setEmail("manager@routeguard.com");
      setPassword("manager123");
    } else {
      setEmail("amit@routeguard.com");
      setPassword("driver123");
    }
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-4 md:px-6">
          <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground">
            <Shield className="h-4 w-4 text-primary" />
            Logistics Risk Platform
          </div>
          <BrandMark className="justify-self-center" />
          <div className="justify-self-end">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 items-center px-4 py-8 md:px-6">
        <div className="grid w-full gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="hero-band app-panel flex flex-col justify-between p-6 md:p-8">
            <div className="space-y-5">
              <div className="mx-auto w-fit rounded-full border border-primary/20 bg-primary/10 px-4 py-1 text-xs font-medium uppercase tracking-[0.28em] text-primary">
                Fleet Control Hub
              </div>
              <div className="space-y-3 text-center lg:text-left">
                <h2 className="text-4xl font-semibold tracking-tight text-foreground text-balance">
                  Plan smarter routes before road disruptions hit operations.
                </h2>
                <p className="mx-auto max-w-2xl text-sm leading-6 text-muted-foreground lg:mx-0">
                  Track weather, traffic, and disruption news, then coordinate managers and drivers from one live operations dashboard.
                </p>
              </div>
            </div>

            <div className="grid gap-3 pt-6 sm:grid-cols-3">
              <div className="app-panel-muted p-4">
                <Route className="h-5 w-5 text-primary" />
                <p className="mt-3 text-sm font-medium text-foreground">Route Intelligence</p>
                <p className="mt-1 text-xs text-muted-foreground">Compare alternatives and choose the safest corridor first.</p>
              </div>
              <div className="app-panel-muted p-4">
                <Radar className="h-5 w-5 text-accent" />
                <p className="mt-3 text-sm font-medium text-foreground">Live Risk Pulse</p>
                <p className="mt-1 text-xs text-muted-foreground">Weather, traffic, and disruption-news signals in real time.</p>
              </div>
              <div className="app-panel-muted p-4">
                <Shield className="h-5 w-5 text-success" />
                <p className="mt-3 text-sm font-medium text-foreground">Faster Response</p>
                <p className="mt-1 text-xs text-muted-foreground">Delay, reroute, and respond instantly to on-road driver reports.</p>
              </div>
            </div>
          </section>

          <div className="w-full space-y-6">
            <div className="text-center">
              <h3 className="text-3xl font-bold text-foreground text-balance">Welcome Back</h3>
              <p className="mt-2 text-muted-foreground">
                Sign in to access your dashboard
              </p>
            </div>

            <Card className="app-panel">
              <CardHeader>
                <CardTitle className="text-foreground">Sign In</CardTitle>
                <CardDescription>
                  Enter your credentials to continue
                </CardDescription>
              </CardHeader>
              <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="email">Email</FieldLabel>
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="bg-secondary/60 border-border"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="password">Password</FieldLabel>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="bg-secondary/60 border-border"
                    />
                  </Field>
                </FieldGroup>

                {error && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                  disabled={isLoading}
                >
                  {isLoading ? "Signing in..." : "Sign In"}
                </Button>
              </form>

              {/* Quick Login Options */}
              <div className="mt-6 pt-6 border-t border-border">
                <p className="text-sm text-muted-foreground text-center mb-4">
                  Quick Login (Demo)
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex items-center gap-2 border-border bg-background/60 hover:bg-secondary"
                    onClick={() => handleQuickLogin("manager")}
                  >
                    <Users className="h-4 w-4" />
                    <span>Manager</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="flex items-center gap-2 border-border bg-background/60 hover:bg-secondary"
                    onClick={() => handleQuickLogin("driver")}
                  >
                    <Truck className="h-4 w-4" />
                    <span>Driver</span>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Demo Credentials */}
            <Card className="app-panel-muted border">
              <CardContent className="pt-4">
              <p className="text-sm font-medium text-foreground mb-2">Demo Credentials:</p>
              <div className="space-y-2 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Manager:</span>
                  <span className="font-mono">manager@routeguard.com / manager123</span>
                </div>
                <div className="flex justify-between">
                  <span>Driver:</span>
                  <span className="font-mono">amit@routeguard.com / driver123</span>
                </div>
              </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
