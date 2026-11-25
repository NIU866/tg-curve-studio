const NS = "http://www.w3.org/2000/svg";
const WIDTH = 960;
const HEIGHT = 350;
const LEFT = 80;
const TOP = 24;
const RIGHT = 32;
const BOTTOM = 56;
const PLOT_X = WIDTH - LEFT - RIGHT;
const PLOT_Y = HEIGHT - TOP - BOTTOM;
const FONTS = "Arial, Microsoft YaHei, sans-serif";

function element(parent, name, attributes, text) {
  const el = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
  if (text != null) el.textContent = text;
  parent.append(el);
  return el;
}

function extent(series, key) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const { points } of series) {
    for (const point of points) {
      lo = Math.min(lo, point[key]);
      hi = Math.max(hi, point[key]);
    }
  }
  if (lo === hi) {
    lo -= Math.abs(lo) / 10 || 1;
    hi += Math.abs(hi) / 10 || 1;
  }
  return [lo, hi];
}

function ticks(lo, hi, count) {
  const raw = (hi - lo) / count;
  const unit = 10 ** Math.floor(Math.log10(raw));
  const magnitude = raw / unit;
  const step = [1, 2, 2.5, 5, 10].find(value => value >= magnitude) * unit;
  const first = Math.floor(lo / step);
  const last = Math.ceil(hi / step);
  return Array.from({ length: last - first + 1 }, (_, index) => (first + index) * step);
}

function sample(points, key) {
  if (points.length <= 2400) return points;
  const result = [points[0]];
  const stride = Math.ceil((points.length - 2) / 1100);
  for (let begin = 1; begin < points.length - 1; begin += stride) {
    let low = begin;
    let high = begin;
    for (let cursor = begin + 1; cursor < Math.min(begin + stride, points.length - 1); cursor += 1) {
      if (points[cursor][key] < points[low][key]) low = cursor;
      if (points[cursor][key] > points[high][key]) high = cursor;
    }
    for (const index of low === high ? [low] : [Math.min(low, high), Math.max(low, high)]) result.push(points[index]);
  }
  result.push(points.at(-1));
  return result;
}

export function draw(series, key) {
  const legendHeight = Math.ceil(series.length / 2) * 24 + 8;
  const svg = document.createElementNS(NS, "svg");
  const title = key === "tg" ? "TG 质量（%）" : "DTG 失重速率（%/°C）";
  svg.setAttribute("viewBox", "0 0 " + WIDTH + " " + (HEIGHT + legendHeight));
  svg.setAttribute("width", WIDTH);
  svg.setAttribute("height", HEIGHT + legendHeight);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", title);
  element(svg, "title", {}, title);
  element(svg, "rect", { width: WIDTH, height: HEIGHT + legendHeight, fill: "#fff" });
  const xs = ticks(...extent(series, "x"), 7);
  const ys = ticks(...extent(series, key), 5);
  const xMin = xs[0], xMax = xs.at(-1), yMin = ys[0], yMax = ys.at(-1);
  const xAt = value => LEFT + (value - xMin) / (xMax - xMin) * PLOT_X;
  const yAt = value => TOP + (yMax - value) / (yMax - yMin) * PLOT_Y;
  const label = { "font-family": FONTS, "font-size": 15, fill: "#263847" };
  const format = value => Number(value.toPrecision(5)).toString();
  for (const value of xs) {
    const x = xAt(value);
    element(svg, "line", { x1:x, y1:TOP, x2:x, y2:TOP+PLOT_Y, stroke:"#dbe5ea" });
    element(svg, "text", { ...label, x, y:TOP+PLOT_Y+21, "text-anchor":"middle" }, format(value));
  }
  for (const value of ys) {
    const y = yAt(value);
    element(svg, "line", { x1:LEFT, y1:y, x2:LEFT+PLOT_X, y2:y, stroke:"#dbe5ea" });
    element(svg, "text", { ...label, x:LEFT-12, y:y+5, "text-anchor":"end" }, format(value));
  }
  element(svg, "rect", { x:LEFT, y:TOP, width:PLOT_X, height:PLOT_Y, fill:"none", stroke:"#546b77" });
  element(svg, "text", { ...label, x:LEFT+PLOT_X/2, y:HEIGHT-8, "text-anchor":"middle" }, "温度（°C）");
  element(svg, "text", { ...label, transform:"translate(22 " + (TOP+PLOT_Y/2) + ") rotate(-90)", "text-anchor":"middle", "font-size":16 }, title);

  series.forEach(({ points, color, name }, index) => {
    const coords = sample(points, key).map(point => xAt(point.x).toFixed(2) + "," + yAt(point[key]).toFixed(2));
    element(svg, "path", { d:"M" + coords.join(" L"), stroke:color, fill:"none", "stroke-width":2.5, "stroke-linejoin":"round" });
    const x = LEFT + (index % 2) * 435;
    const y = HEIGHT + Math.floor(index / 2) * 24 + 14;
    element(svg, "line", { x1:x, y1:y, x2:x+23, y2:y, stroke:color, "stroke-width":3 });
    element(svg, "text", { ...label, x:x+32, y:y+5 }, name.length > 32 ? name.slice(0, 31) + "…" : name);
  });
  return svg;
}
