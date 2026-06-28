import React, { useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Marker, Circle, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet's default marker icon paths under Webpack/CRA — without this the marker
// renders as a broken-image. We point to the unpkg CDN copies (no extra build setup).
const DEFAULT_ICON = new L.Icon({
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize:    [25, 41],
  iconAnchor:  [12, 41],
  popupAnchor: [1,  -34],
  shadowSize:  [41, 41],
});

/**
 * Reusable map picker.
 *   <MapPicker value={{lat, lng}} onChange={(p)=>...} radiusM={200} />
 * Behaviour:
 *   - Click anywhere on the map → marker jumps there.
 *   - Drag the marker → emits onChange continuously (final on dragend).
 *   - When `radiusM` is given, draws a translucent circle so admins can preview the geofence radius.
 *   - When `value` changes externally (e.g. "Use my current location" button), map recenters.
 */
export default function MapPicker({ value, onChange, radiusM = 0, height = 320 }) {
  const lat = parseFloat(value?.lat);
  const lng = parseFloat(value?.lng);
  const hasPos = Number.isFinite(lat) && Number.isFinite(lng);
  const initial = useMemo(() => hasPos ? [lat, lng] : [20.5937, 78.9629], [hasPos, lat, lng]); // India centre default
  const markerRef = useRef(null);

  return (
    <div className="border border-[var(--border)]" style={{ height }} data-testid="map-picker">
      <MapContainer
        center={initial}
        zoom={hasPos ? 15 : 5}
        scrollWheelZoom
        style={{ width: "100%", height: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapClickHandler onPick={onChange} />
        <Recenter pos={hasPos ? [lat, lng] : null} />
        {hasPos && (
          <Marker
            position={[lat, lng]}
            icon={DEFAULT_ICON}
            draggable
            ref={markerRef}
            eventHandlers={{
              drag: (e) => onChange?.({ lat: e.target.getLatLng().lat, lng: e.target.getLatLng().lng }),
              dragend: (e) => onChange?.({ lat: e.target.getLatLng().lat, lng: e.target.getLatLng().lng }),
            }}
          />
        )}
        {hasPos && radiusM > 0 && (
          <Circle center={[lat, lng]} radius={Number(radiusM)} pathOptions={{ color: "#0a3aa8", fillOpacity: 0.08 }} />
        )}
      </MapContainer>
    </div>
  );
}

function MapClickHandler({ onPick }) {
  useMapEvents({
    click(e) { onPick?.({ lat: e.latlng.lat, lng: e.latlng.lng }); },
  });
  return null;
}

function Recenter({ pos }) {
  const map = useMap();
  useEffect(() => {
    if (pos) map.flyTo(pos, Math.max(map.getZoom(), 15), { duration: 0.6 });
  }, [pos, map]);
  return null;
}
