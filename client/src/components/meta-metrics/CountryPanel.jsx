import GlassPanel from './GlassPanel';
import LiveWorldMap from './LiveWorldMap';

const PANEL_LEFT_PX = 462;
const PANEL_TOP_PX = 494;
const PANEL_WIDTH_PX = 306;
const PANEL_HEIGHT_PX = 192;
const HEADER_HEIGHT_PX = 26;

export default function CountryPanel({ liveView }) {
  return (
    <GlassPanel
      left={PANEL_LEFT_PX}
      top={PANEL_TOP_PX}
      width={PANEL_WIDTH_PX}
      height={PANEL_HEIGHT_PX}
      gradientAngle={216.787925}
    >
      <p
        style={{
          position: 'absolute',
          left: 12,
          top: 10,
          zIndex: 10,
          fontFamily: 'Inter, sans-serif',
          fontWeight: 600,
          fontSize: 11,
          color: 'rgba(242,248,255,0.96)',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          letterSpacing: '-0.01em'
        }}
      >
        Global Live View
      </p>

      <div
        style={{
          position: 'absolute',
          left: 0,
          top: HEADER_HEIGHT_PX,
          width: PANEL_WIDTH_PX,
          height: PANEL_HEIGHT_PX - HEADER_HEIGHT_PX,
          borderBottomLeftRadius: 22,
          borderBottomRightRadius: 22,
          overflow: 'hidden'
        }}
      >
        <LiveWorldMap liveView={liveView} width={PANEL_WIDTH_PX} height={PANEL_HEIGHT_PX - HEADER_HEIGHT_PX} />
      </div>
    </GlassPanel>
  );
}
