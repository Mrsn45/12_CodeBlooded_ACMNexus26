import pickle

FEATURE_ORDER = [
    "distance_km",
    "traffic_score",
    "weather_score",
    "historical_score"
]

def load_model():
    with open("delay_model.pkl", "rb") as f:
        return pickle.load(f)

def risk_label(prob):
    if prob < 0.3:
        return "Low"
    elif prob < 0.7:
        return "Medium"
    else:
        return "High"

def generate_reason(route):
    reasons = []

    if route["traffic_score"] < 0.4:
        reasons.append("low traffic")
    if route["weather_score"] < 0.4:
        reasons.append("favorable weather")
    if route["historical_score"] < 0.4:
        reasons.append("good historical performance")
    if route["distance_km"] < 800:
        reasons.append("shorter distance")

    if not reasons:
        return "balanced overall conditions"
    
    return ", ".join(reasons)


def generate_suggestion(route):
    if route["traffic_score"] > 0.7:
        return "Avoid peak traffic hours"
    if route["weather_score"] > 0.7:
        return "Monitor weather conditions"
    if route["historical_score"] > 0.7:
        return "Plan buffer time due to past delays"
    return "Route conditions are stable"


def predict_routes(model, routes):

    output_routes = []

    for route in routes:
        features = [route[f] for f in FEATURE_ORDER]
        prob = float(model.predict_proba([features])[0][1])

        output_routes.append({
            "route_id": route["route_id"],
            "risk_score": round(prob, 2),
            "risk_level": risk_label(prob),
            "reason": generate_reason(route),
            "suggestion": generate_suggestion(route)
        })

    best = min(output_routes, key=lambda x: x["risk_score"])

    return {
        "routes": output_routes,
        "recommended_route": best["route_id"],
        "reason": f"{best['route_id']} selected due to {best['reason']}",
        "suggestion": best["suggestion"]
    }