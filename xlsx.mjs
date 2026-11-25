import { unzipSync } from "./vendor/zip.mjs";

function elements(node, name) {
  return Array.from(node.getElementsByTagNameNS("*", name));
}

function parseXml(bytes) {
  if (!bytes) throw Error("Excel 缺少必要的工作簿内容");
  const xml = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "application/xml");
  if (xml.doctype || elements(xml, "parsererror").length) throw Error("Excel 表结构无法读取");
  return xml;
}

function cellIndex(reference) {
  const name = reference?.match(/^[A-Z]{1,3}(?=\d+$)/i)?.[0].toUpperCase();
  if (!name) return -1;
  return [...name].reduce((index, char) => index * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

export function readWorkbook(bytes) {
  let expanded = 0;
  const files = unzipSync(bytes, { filter: entry => {
    if (!/^xl\/(?:worksheets\/[^/]+\.xml|sharedStrings\.xml|workbook\.xml|_rels\/workbook\.xml\.rels)$/i.test(entry.name)) return false;
    expanded += entry.originalSize;
    if (expanded > 48 * 1024 ** 2) throw Error("Excel 展开后超过 48 MB，请拆分工作簿");
    return true;
  } });
  const names = elements(parseXml(files["xl/workbook.xml"]), "sheet");
  const relations = elements(parseXml(files["xl/_rels/workbook.xml.rels"]), "Relationship");
  const shared = files["xl/sharedStrings.xml"]
    ? elements(parseXml(files["xl/sharedStrings.xml"]), "si").map(item => elements(item, "t").map(text => text.textContent).join(""))
    : [];
  return names.flatMap(sheet => {
    const id = sheet.getAttribute("r:id") || sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const target = relations.find(relation => relation.getAttribute("Id") === id)?.getAttribute("Target") ?? "";
    const name = target.startsWith("/") ? target.slice(1) : "xl/" + target;
    if (!/^xl\/worksheets\/[^/]+\.xml$/i.test(name) || !files[name]) return [];
    return [{
      name: sheet.getAttribute("name") || "工作表",
      read() {
        const rows = elements(parseXml(files[name]), "row");
        if (rows.length > 100000) throw Error("每张工作表最多支持 100,000 行");
        return rows.map(row => {
          const result = [];
          for (const cell of row.children) {
            if (cell.localName !== "c") continue;
            const index = cellIndex(cell.getAttribute("r"));
            if (index < 0 || index >= 128) continue;
            const value = elements(cell, "v")[0]?.textContent ?? "";
            const type = cell.getAttribute("t");
            if (type === "e" || type === "b") continue;
            result[index] = type === "s" ? shared[Number(value)] ?? "" :
              type === "inlineStr" ? elements(cell, "t").map(text => text.textContent).join("") : value;
          }
          return result;
        });
      }
    }];
  });
}
