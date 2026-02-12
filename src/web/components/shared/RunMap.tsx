import { useMemo } from 'react';
import { MapContainer, Polyline, TileLayer } from 'react-leaflet';
import polyline from '@mapbox/polyline';

export function RunMap({ encodedPolyline }: { encodedPolyline: string }) {
  const points = useMemo(() => {
    try {
      return polyline.decode(encodedPolyline) as [number, number][];
    } catch {
      return [];
    }
  }, [encodedPolyline]);

  if (points.length === 0) {
    return <div className="empty-box">暂无路线数据</div>;
  }

  const center = points[Math.floor(points.length / 2)];

  return (
    <div className="map-wrap">
      <MapContainer center={center} zoom={13} scrollWheelZoom={false} className="run-map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Polyline positions={points} pathOptions={{ color: '#ff6d3f', weight: 4 }} />
      </MapContainer>
    </div>
  );
}
