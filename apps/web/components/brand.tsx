// The strongChar mark: a 3x3 lattice (ML-KEM is lattice cryptography) whose centre tile, the sealed one, is vermilion.
import { cx } from "./primitives";

const TILES = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => ({ r, c })));

export function BrandMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cx("inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-brand-ink p-1.5", className)}>
      <svg viewBox="0 0 30 30" className="h-full w-full">
        {TILES.map(({ r, c }) => {
          const centre = r === 1 && c === 1;
          const lit = centre || (r + c) % 2 === 0;
          return (
            <rect key={`${r}${c}`} x={c * 10 + 1} y={r * 10 + 1} width={8} height={8} rx={0.6}
                  className={centre ? "fill-brand-mark" : lit ? "fill-ink" : "fill-ink/25"} />
          );
        })}
      </svg>
    </span>
  );
}
