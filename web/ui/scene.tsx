// A pixel landscape on a 240 by 80 grid. The CSS colours it as day or night, following the theme.
import React from "react";

const W = 240;
const H = 80;

// The same "random" numbers on every render, so the scene never jumps between repaints.
const rand = (seed: number) => {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
};

// A hill line as columns, joining equal neighbours into one rectangle.
function ridge(base: number, waves: [number, number, number][], className: string) {
  const heights = Array.from({ length: W }, (_, x) => Math.round(base - waves.reduce((sum, [amp, len, phase]) => sum + amp * Math.sin(x / len + phase), 0)));
  const rects: React.ReactElement[] = [];
  let start = 0;
  for (let x = 1; x <= W; x++) {
    if (x < W && heights[x] === heights[start]) continue;
    rects.push(<rect key={start} x={start} y={heights[start]} width={x - start} height={H - heights[start]} />);
    start = x;
  }
  return <g className={className}>{rects}</g>;
}

function disc(cx: number, cy: number, r: number, className: string) {
  const rects: React.ReactElement[] = [];
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt(r * r - dy * dy));
    rects.push(<rect key={dy} x={cx - half} y={cy + dy} width={half * 2 + 1} height={1} />);
  }
  return <g className={className}>{rects}</g>;
}

function cloud(x: number, y: number, size: number, key: number) {
  const s = size;
  return (
    <g key={key} className="sc-cloud" style={{ animationDuration: `${90 + key * 23}s` }}>
      <rect x={x} y={y + 2 * s} width={10 * s} height={2 * s} />
      <rect x={x + 2 * s} y={y + s} width={6 * s} height={s} />
      <rect x={x + 3 * s} y={y} width={3 * s} height={s} />
    </g>
  );
}

function tree(x: number, ground: number, key: number) {
  return (
    <g key={key} className="sc-tree">
      <rect x={x + 2} y={ground - 9} width={1} height={2} />
      <rect x={x + 1} y={ground - 7} width={3} height={3} />
      <rect x={x} y={ground - 4} width={5} height={3} />
      <rect className="sc-trunk" x={x + 2} y={ground - 1} width={1} height={2} />
    </g>
  );
}

const STARS = Array.from({ length: 46 }, (_, i) => ({ x: Math.floor(rand(i) * W), y: Math.floor(rand(i + 100) * 36), big: rand(i + 200) > 0.85, delay: rand(i + 300) * 4 }));

export function Scene({ className = "" }: { className?: string }) {
  return (
    <svg className={`scene ${className}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" shapeRendering="crispEdges" aria-hidden="true">
      <rect className="sc-sky1" width={W} height={H} />
      <rect className="sc-sky2" y={22} width={W} height={H - 22} />
      <rect className="sc-sky3" y={38} width={W} height={H - 38} />
      <g className="sc-stars">
        {STARS.map((s, i) => <rect key={i} x={s.x} y={s.y} width={s.big ? 2 : 1} height={s.big ? 2 : 1} style={{ animationDelay: `${s.delay}s` }} />)}
      </g>
      <g className="sc-sun">{disc(196, 16, 8, "sc-sun-core")}{disc(196, 16, 5, "sc-sun-inner")}</g>
      <g className="sc-moon">{disc(196, 16, 8, "sc-moon-core")}{disc(201, 13, 7, "sc-moon-cut")}</g>
      <g className="sc-clouds">{cloud(20, 10, 2, 1)}{cloud(120, 20, 1, 2)}{cloud(150, 6, 2, 3)}{cloud(70, 28, 1, 4)}</g>
      {ridge(44, [[6, 23, 0.4], [3, 9, 1.3]], "sc-hill3")}
      {[18, 31, 150, 161, 204].map((x, i) => tree(x, 46 + (i % 2) * 2, i))}
      {ridge(56, [[4, 31, 2.1], [2, 11, 0.2]], "sc-hill2")}
      {[60, 92, 118, 226].map((x, i) => tree(x, 57 + (i % 2), i + 10))}
      {ridge(66, [[2, 40, 1], [1, 13, 3]], "sc-hill1")}
      <rect className="sc-ground" y={70} width={W} height={10} />
      <g className="sc-path">{Array.from({ length: W / 6 }, (_, i) => <rect key={i} x={i * 6 + 1} y={74} width={3} height={1} />)}</g>
    </svg>
  );
}
