import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
import pickle

np.random.seed(42)
n = 500

data = pd.DataFrame({
    "distance_km": np.random.randint(50, 1500, n),
    "traffic_score": np.random.uniform(0, 1, n),
    "weather_score": np.random.uniform(0, 1, n),
    "historical_score": np.random.uniform(0, 1, n)
})

data["delay"] = (
    (data["traffic_score"] > 0.7) |
    (data["weather_score"] > 0.6) |
    (data["historical_score"] > 0.65) |
    (data["distance_km"] > 1200)
).astype(int)

X = data.drop("delay", axis=1)
y = data["delay"]

model = RandomForestClassifier()
model.fit(X, y)

with open("delay_model.pkl", "wb") as f:
    pickle.dump(model, f)

print("Model saved")