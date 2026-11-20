/** Set steps of the logo's 4x4 step grid (column, row): the L plus one off-beat. */
const SET_STEPS = new Set(["0,0", "0,1", "0,2", "0,3", "1,3", "2,3", "3,3", "2,1"]);
/** Same proportions as /public/Logo.svg (36-unit steps on a 48-unit pitch), in a 24-unit box. */
const PITCH = 4.8;
const STEP = 3.6;
const ORIGIN = 3;

/**
 * On-brand stand-in for missing cover art: dark brand-lime gradient with the
 * step-sequencer glyph from the logo, scaled to the tile. Pass sizing/rounding
 * (e.g. "w-10 h-10 rounded") via className, exactly like the <img> it replaces.
 */
export default function CoverPlaceholder({
  className = "",
  "data-traverse-card": traverseCard,
}: {
  className?: string;
  /** Passed on from `Cover`; see there. */
  "data-traverse-card"?: string;
}) {
  const cells = [];
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      const x = ORIGIN + column * PITCH;
      const y = ORIGIN + row * PITCH;
      cells.push(
        SET_STEPS.has(`${column},${row}`)
          ? <rect key={`${column},${row}`} x={x} y={y} width={STEP} height={STEP} rx={1} />
          : <circle key={`${column},${row}`} cx={x + STEP / 2} cy={y + STEP / 2} r={0.6} />,
      );
    }
  }
  return (
    <div
      aria-hidden
      data-traverse-card={traverseCard}
      className={`grid place-items-center overflow-hidden gradient-brand ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        className="h-[46%] w-[46%] text-accent/55"
      >
        {cells}
      </svg>
    </div>
  );
}
