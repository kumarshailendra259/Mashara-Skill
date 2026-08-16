import React, { useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Marker, Circle, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Google-Maps-style red location pin — inline SVG so we don't need extra assets.
// The pin has a subtle shadow filter and a white centre dot to match Google's marker.
const GMAPS_RED_PIN_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="34" height="46" viewBox="0 0 34 46">
  <defs>
    <filter id="pinShadow" x="-30%" y="-10%" width="160%" height="130%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="1.4" />
      <feOffset dx="0" dy="1.6" result="oShadow" />
      <feComponentTransfer><feFuncA type="linear" slope="0.35" /></feComponentTransfer>
      <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
    </filter>
  </defs>
  <g filter="url(#pinShadow)">
    <path d="M17 1 C8.16 1 1 8.16 1 17 c0 11.6 14.4 26.4 15.02 27.02 a1.4 1.4 0 0 0 1.96 0 C18.6 43.4 33 28.6 33 17 33 8.16 25.84 1 17 1 z"
          fill="#E53935" stroke="#B71C1C" stroke-width="0.8" />
    <circle cx="17" cy="17" r="5.6" fill="#ffffff" />
  </g>
</svg>`.trim();

const RED_PIN_ICON = L.divIcon({
  html: GMAPS_RED_PIN_SVG,
  className: "gmap-red-pin",  // strip default leaflet-div-icon border
  iconSize:    [34, 46],
  iconAnchor:  [17, 44],   // tip of the pin
  popupAnchor: [0, -40],
});

/**
 * Reusable map picker — Google-Maps-style Voyager basemap + red pin + turquoise geofence circle.
 *   <MapPicker value={{lat, lng}} onChange={(p)=>...} radiusM={200} />
 * Behaviour:
 *   - Click anywhere on the map → marker jumps there.
 *   - Drag the marker → emits onChange continuously (final on dragend).
 *   - When `radiusM` is given, draws a semi-transparent turquoise circle so admins can preview the geofence.
 *   - When `value` changes externally (e.g. "Use my current location" button), map recenters.
 */
export default function MapPicker({ value, onChange, radiusM = 0, height = 320 }) {
  const lat = parseFloat(value?.lat);
  const lng = parseFloat(value?.lng);
  const hasPos = Number.isFinite(lat) && Number.isFinite(lng);
  const initial = useMemo(() => hasPos ? [lat, lng] : [20.5937, 78.9629], [hasPos, lat, lng]); // India centre default
  const markerRef = useRef(null);

  return (
    <div className="border border-[var(--border)] gmap-picker-wrap" style={{ height }} data-testid="map-picker">
      {/* Strip the default Leaflet divIcon white background + border for our custom SVG pin. */}
      <style>{`.gmap-red-pin{background:transparent!important;border:none!important;}`}</style>
      <MapContainer
        center={initial}
        zoom={hasPos ? 16 : 5}
        scrollWheelZoom
        style={{ width: "100%", height: "100%" }}
      >
        {/* CartoDB Voyager — Google-Maps-style roads/buildings/labels, no API key required.
            Retina ({r}) auto-serves @2x tiles on high-DPI screens. */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          subdomains={["a", "b", "c", "d"]}
          maxZoom={20}
        />
        <MapClickHandler onPick={onChange} />
        <Recenter pos={hasPos ? [lat, lng] : null} />
        {hasPos && (
          <Marker
            position={[lat, lng]}
            icon={RED_PIN_ICON}
            draggable
            ref={markerRef}
            eventHandlers={{
              drag: (e) => onChange?.({ lat: e.target.getLatLng().lat, lng: e.target.getLatLng().lng }),
              dragend: (e) => onChange?.({ lat: e.target.getLatLng().lat, lng: e.target.getLatLng().lng }),
            }}
          />
        )}
        {hasPos && radiusM > 0 && (
          <Circle
            center={[lat, lng]}
            radius={Number(radiusM)}
            pathOptions={{
              color: "#14b8a6",       // turquoise border
              weight: 2,
              fillColor: "#14b8a6",   // turquoise fill
              fillOpacity: 0.22,      // semi-transparent
            }}
          />
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
