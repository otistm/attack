/**
 * Arena backdrop for element brawl.
 */
export function Scene() {
  return (
    <div className="w-full h-full absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url(/images/arena_floor.png)" }}
        aria-hidden="true"
      />
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
    </div>
  );
}
