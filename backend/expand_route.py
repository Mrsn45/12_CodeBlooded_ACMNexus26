from geopy.geocoders import Nominatim
from geopy.distance import geodesic

MAJOR_CITIES = {
    "Mumbai": (19.0760, 72.8777),
    "Pune": (18.5204, 73.8567),
    "Nashik": (19.9975, 73.7898),
    "Ahmedabad": (23.0225, 72.5714),
    "Jaipur": (26.9124, 75.7873),
    "Delhi": (28.6139, 77.2090),
    "Bhopal": (23.2599, 77.4126),
    "Indore": (22.7196, 75.8577),
    "Nagpur": (21.1458, 79.0882),
    "Agra": (27.1767, 78.0081),
    "Lucknow": (26.8467, 80.9462),
    "Kanpur": (26.4499, 80.3319),
    "Varanasi": (25.3176, 82.9739),
    "Patna": (25.5941, 85.1376),
    "Kolkata": (22.5726, 88.3639),
    "Bhubaneswar": (20.2961, 85.8245),
    "Visakhapatnam": (17.6868, 83.2185),
    "Hyderabad": (17.3850, 78.4867),
    "Bengaluru": (12.9716, 77.5946),
    "Chennai": (13.0827, 80.2707),
    "Kochi": (9.9312, 76.2673),
    "Thiruvananthapuram": (8.5241, 76.9366),
    "Goa": (15.2993, 74.1240),
    "Surat": (21.1702, 72.8311),
    "Udaipur": (24.5854, 73.7125)
}


def get_coordinates(city):
    geolocator = Nominatim(user_agent="route-generator")
    location = geolocator.geocode(city)
    return (location.latitude, location.longitude)


def generate_intermediate_cities(origin, destination, max_cities=4):

    origin_coord = get_coordinates(origin)
    dest_coord = get_coordinates(destination)

    candidates = []
    direct_distance = geodesic(origin_coord, dest_coord).km

    for city, coord in MAJOR_CITIES.items():

        if city in [origin, destination]:
            continue

        d1 = geodesic(origin_coord, coord).km
        d2 = geodesic(coord, dest_coord).km

        # city near route
        if d1 + d2 <= direct_distance * 1.3:
            candidates.append((city, d1))

    # sort in route order
    candidates.sort(key=lambda x: x[1])

    intermediates = [city for city, _ in candidates[:max_cities]]

    return [origin] + intermediates + [destination]
