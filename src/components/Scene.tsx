/**
 * Minimal backdrop for element brawl — no baseball field.
 */
export function Scene() {
  return (
    <div className="w-full h-full absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-[#0f172a] to-slate-900" />
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 120%, rgba(59,130,246,0.25) 0%, transparent 55%), radial-gradient(circle at 20% 20%, rgba(168,85,247,0.12) 0%, transparent 40%)",
        }}
      />
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
    </div>
  );
}
