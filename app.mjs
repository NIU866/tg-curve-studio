import { calculate, defineColumns, parseCsv } from "./data.mjs";
import { readWorkbook } from "./xlsx.mjs";
import { draw } from "./plot.mjs";

const $ = id => document.getElementById(id);
const colors = ["#046c64", "#c65527", "#2359a9", "#8a42a6", "#986414", "#af3059"];
const sets = [];
const fileInput = $("files");
const feedback = $("feedback");
const plots = { tg: $("plot-tg"), dtg: $("plot-dtg") };

function create(name, text, parent) {
  const element = document.createElement(name);
  if (text) element.textContent = text;
  if (parent) parent.append(element);
  return element;
}

function select(card, label, values, current, change) {
  const container = create("label", label, card);
  const input = create("select", null, container);
  values.forEach(([value, text]) => {
    const option = create("option", text, input);
    option.value = value;
  });
  input.value = current;
  input.addEventListener("change", () => change(input.value));
}

function setSheet(set, index) {
  Object.assign(set, defineColumns(set.sheets[index].read()));
  set.sheet = index;
  set.basis = "relative";
}

function addSet(name, sheets, basis) {
  if (!sheets.length) throw Error("找不到受支持的工作表");
  const set = { name, sheets, color: colors.find(color => sets.every(item => item.color !== color)), visible: true };
  let lastError;
  for (let index = 0; index < sheets.length; index += 1) {
    try { setSheet(set, index); lastError = null; break; } catch (error) { lastError = error; }
  }
  if (lastError) throw lastError;
  if (basis) set.basis = basis;
  sets.push(set);
}

function renderCards() {
  $("datasets").replaceChildren();
  sets.forEach((set, index) => {
    const card = create("section", null, $("datasets"));
    card.className = "dataset";
    card.style.setProperty("--curve", set.color);
    const header = create("header", null, card);
    create("strong", set.name, header);
    const remove = create("button", "移除", header);
    remove.setAttribute("aria-label", "移除 " + set.name);
    remove.addEventListener("click", () => { sets.splice(index, 1); renderCards(); });
    if (set.sheets.length > 1) {
      select(card, "工作表", set.sheets.map((sheet, number) => [number, sheet.name]), set.sheet, value => {
        try {
          setSheet(set, Number(value));
          feedback.textContent = "";
        } catch (error) {
          feedback.textContent = error.message;
        }
        renderCards();
      });
    }
    const columns = set.columns.map((name, number) => [number, name]);
    select(card, "温度列", columns, set.x, value => { set.x = Number(value); renderPlots(); });
    select(card, "质量列", columns, set.y, value => { set.y = Number(value); renderPlots(); });
    select(card, "质量单位", [
      ["relative", "质量 · 换算为初值百分比"],
      ["percent", "已是 0–100 的百分数"],
      ["fraction", "0–1 的质量比例"]
    ], set.basis, value => { set.basis = value; renderPlots(); });
    const visibility = create("label", "显示曲线", card);
    const toggle = create("input", null, visibility);
    toggle.type = "checkbox";
    toggle.checked = set.visible;
    toggle.addEventListener("change", () => { set.visible = toggle.checked; renderPlots(); });
    set.status = create("p", null, card);
  });
  renderPlots();
}

function renderPlots() {
  const charted = [];
  for (const set of sets) {
    try {
      const metrics = calculate(set.data, set.x, set.y, set.basis, $("window").value);
      set.status.className = "info";
      set.status.textContent = metrics.points.length + " 点" + (metrics.ignored ? " · 略过 " + metrics.ignored + " 行" : "") +
        (metrics.combined ? " · 合并 " + metrics.combined + " 个重复温度" : "");
      if (set.visible) charted.push({ name: set.name, color: set.color, ...metrics });
    } catch (error) {
      set.status.className = "error";
      set.status.textContent = error.message;
    }
  }
  for (const key of ["tg", "dtg"]) {
    plots[key].replaceChildren();
    if (charted.length) plots[key].append(draw(charted, key));
    else create("p", "导入并选中有效数据后显示曲线", plots[key]);
    $("export-" + key).disabled = !charted.length;
  }
}

$("import").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const files = [...fileInput.files];
  fileInput.value = "";
  $("import").disabled = true;
  $("demo").disabled = true;
  const errors = [];
  for (const file of files) {
    if (sets.length >= colors.length) { errors.push("最多叠加 6 组曲线"); break; }
    try {
      if (file.size > 16 * 1024 ** 2) throw Error("单个文件最多 16 MB");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let sheets;
      if (/\.xlsx$/i.test(file.name)) sheets = readWorkbook(bytes);
      else {
        let text;
        try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
        catch { text = new TextDecoder("gb18030", { fatal: true }).decode(bytes); }
        sheets = [{ name: "数据", read: () => parseCsv(text) }];
      }
      addSet(file.name.replace(/\.[^.]+$/, ""), sheets);
    } catch (error) {
      errors.push(file.name + " · " + error.message);
    }
  }
  feedback.textContent = errors.join("。");
  renderCards();
  $("import").disabled = false;
  $("demo").disabled = false;
});

$("demo").addEventListener("click", () => {
  const examples = [["示例 A", 362, 63], ["示例 B", 403, 77]];
  for (const [name, peak, loss] of examples) {
    if (sets.length >= colors.length || sets.some(set => set.name === name)) continue;
    const rows = [["温度（°C）", "质量（%）"]];
    for (let temperature = 30; temperature <= 800; temperature += 2) {
      const mass = 100 - 3 / (1 + Math.exp((111 - temperature) / 12)) - loss / (1 + Math.exp((peak - temperature) / 26));
      rows.push([temperature, mass]);
    }
    addSet(name, [{ name: "示例", read: () => rows }], "percent");
  }
  feedback.textContent = sets.length >= colors.length ? "曲线已达 6 组，移除一组可继续导入。" : "";
  renderCards();
});
$("window").addEventListener("change", renderPlots);
for (const key of ["tg", "dtg"]) {
  $("export-" + key).addEventListener("click", () => {
    const svg = plots[key].querySelector("svg");
    if (!svg) return;
    const bytes = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/svg+xml;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "thermal-lab-" + key + ".svg";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
}
