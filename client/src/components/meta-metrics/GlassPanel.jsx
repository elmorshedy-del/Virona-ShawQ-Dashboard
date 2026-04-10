export default function GlassPanel({
  left,
  top,
  width,
  height,
  gradientAngle,
  children
}) {
  return (
    <div className="absolute rounded-[22px]" style={{ left, top, width, height }}>
      <div
        aria-hidden="true"
        className="absolute inset-0 rounded-[22px] backdrop-blur-[12px] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(${gradientAngle}deg, rgba(49,93,242,0.208) 70.981%, rgba(9,20,55,0.22) 70.981%)`
        }}
      />
      <div className="relative overflow-clip size-full rounded-[inherit]">
        {children}
      </div>
      <div className="absolute inset-0 rounded-[inherit] pointer-events-none shadow-[inset_0px_1px_8px_0px_rgba(230,250,255,0.08)]" />
      <div
        aria-hidden="true"
        className="absolute inset-0 rounded-[22px] border border-solid pointer-events-none shadow-[0px_18px_36px_0px_rgba(3,8,22,0.42)]"
        style={{ borderColor: 'rgba(176,216,255,0.16)' }}
      />
    </div>
  );
}
