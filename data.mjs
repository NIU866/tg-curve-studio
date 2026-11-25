export function parseCsv(text) {
  text = text.replace(/^\uFEFF/, "");
  const counts = { ",": 0, "\t": 0, ";": 0 };
  let quoted = false;
  let lines = 0;
  for (const char of text.slice(0, 8192)) {
    if (char === '"') quoted = !quoted;
    if (!quoted && char in counts) counts[char] += 1;
    if (!quoted && char === "\n" && ++lines === 12) break;
  }
  const separator = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const rows = [];
  let row = [];
  let field = "";
  quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (quoted || !field.trim()) {
        quoted = !quoted;
      } else {
        field += char;
      }
    } else if (char === separator && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some(cell => cell.trim())) rows.push(row);
      if (rows.length > 100000) throw Error("每份数据最多支持 100,000 行");
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) throw Error("CSV 中有未闭合的引号");
  row.push(field);
  if (row.some(cell => cell.trim())) rows.push(row);
  return rows;
}

export function parseNumber(value) {
  const text = String(value ?? "").trim().replace(/^[−－]/, "-").replace(/[%％]$/, "");
  return text && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)
    ? Number(text) : NaN;
}

export function defineColumns(rows) {
  const numericRow = rows.findIndex(row => row.filter(cell => Number.isFinite(parseNumber(cell))).length >= 2);
  if (numericRow < 0) throw Error("找不到至少两列数值");
  const header = rows[numericRow - 1] ?? [];
  const data = rows.slice(numericRow);
  const width = Math.min(128, data.slice(0, 50).reduce((max, row) => Math.max(max, row.length), header.length));
  const columns = Array.from({ length: width }, (_, index) => String(header[index] || "第 " + (index + 1) + " 列"));
  const numeric = columns.map((_, index) => index).filter(index => data.slice(0, 70).some(row => Number.isFinite(parseNumber(row[index]))));
  const x = numeric.find(index => /temp|温度|℃|°c/i.test(columns[index])) ?? numeric[0];
  const y = numeric.find(index => index !== x && /mass|weight|质量|重量|剩余|^tg/i.test(columns[index])) ?? numeric.find(index => index !== x);
  return { data, columns, x, y };
}

export function calculate(rows, xColumn, yColumn, basis, spread) {
  if (xColumn === yColumn) throw Error("温度和质量须选择不同列");
  const valid = [];
  for (const row of rows) {
    const x = parseNumber(row[xColumn]);
    const y = parseNumber(row[yColumn]);
    if (Number.isFinite(x) && Number.isFinite(y)) valid.push([x, y]);
  }
  if (valid.length < 3) throw Error("需要至少 3 个温度和质量数据点");
  let direction = 0;
  for (let index = 1; index < valid.length; index += 1) {
    const step = Math.sign(valid[index][0] - valid[index - 1][0]);
    if (step && direction && step !== direction) throw Error("温度有回升或回落，请截取单段升温数据");
    if (step) direction = step;
  }
  if (direction < 0) valid.reverse();
  const points = [];
  for (const [x, y] of valid) {
    const last = points.at(-1);
    if (last?.x === x) {
      last.sum += y;
      last.count += 1;
    } else {
      points.push({ x, sum: y, count: 1 });
    }
  }
  if (points.length < 3) throw Error("至少需要 3 个不同温度");
  const initial = points[0].sum / points[0].count;
  if (basis === "relative" && initial <= 0) throw Error("初始质量必须大于 0");
  const factor = basis === "relative" ? 100 / initial : basis === "fraction" ? 100 : 1;
  for (const point of points) point.tg = point.sum / point.count * factor;

  const width = Math.min(points.length, Number(spread));
  for (let index = 0; index < points.length; index += 1) {
    const first = Math.max(0, Math.min(index - Math.floor(width / 2), points.length - width));
    const origin = points[first].x;
    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let sumXY = 0;
    for (let cursor = first; cursor < first + width; cursor += 1) {
      const x = points[cursor].x - origin;
      const y = points[cursor].tg;
      sumX += x;
      sumY += y;
      sumXX += x * x;
      sumXY += x * y;
    }
    points[index].dtg = -(sumXY - sumX * sumY / width) / (sumXX - sumX * sumX / width);
  }
  if (points.some(point => !Number.isFinite(point.tg) || !Number.isFinite(point.dtg))) {
    throw Error("数据数值范围过大或温度间隔过小");
  }
  return { points, rows: valid.length, ignored: rows.length - valid.length, combined: valid.length - points.length };
}
