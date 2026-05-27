const crypto = require("node:crypto");

const externalAdapterSamples = require("./externalAdapterSamples");
const { nowISO } = require("./dates");
const { createId } = require("./seed");

function importError(code, message, status = 200) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function ensureBatches(data) {
  if (!Array.isArray(data.importBatches)) data.importBatches = [];
  return data.importBatches;
}

function normalizeSourceType(value) {
  const sourceType = String(value || "").trim().toUpperCase();
  if (!externalAdapterSamples.SOURCE_TYPES[sourceType]) throw importError(4101, "未知导入来源");
  return sourceType;
}

function inputFromBody(body = {}) {
  if (body.samples !== undefined) return { input: body.samples, inputType: "JSON" };
  if (body.text !== undefined) return { input: String(body.text || ""), inputType: "TEXT" };
  throw importError(4102, "请上传或粘贴 CSV 内容");
}

function stableInputText(input) {
  return typeof input === "string" ? input : JSON.stringify(input);
}

function contentHash(sourceType, input) {
  return crypto.createHash("sha256").update(`${sourceType}\n${stableInputText(input)}`).digest("hex");
}

function fileSummary(body = {}, input, preview) {
  return {
    fileName: String(body.fileName || body.file_name || ""),
    mimeType: String(body.mimeType || body.mime_type || ""),
    size: Number(body.size || Buffer.byteLength(stableInputText(input), "utf8")),
    rowCount: preview.total || 0,
  };
}

function publicBatch(batch) {
  return {
    batchId: batch.batch_id,
    sourceType: batch.source_type,
    contentHash: batch.content_hash,
    status: batch.status,
    fileSummary: batch.file_summary,
    preview: batch.preview,
    result: batch.result || null,
    errorMessage: batch.error_message || "",
    confirmedAt: batch.confirmed_at || "",
    createdAt: batch.created_at,
    updatedAt: batch.updated_at,
  };
}

function csvCell(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function rowsForFailureExport(batch) {
  const result = batch.result || batch.preview || {};
  return (result.rows || []).filter((row) => {
    return row.errors && row.errors.length;
  });
}

function exportFailureRowsCsv(data, batchId) {
  const batch = ensureBatches(data).find((item) => item.batch_id === batchId);
  if (!batch) throw importError(4103, "导入批次不存在", 404);
  const rows = rowsForFailureExport(batch);
  const header = ["batchId", "sourceType", "rowIndex", "errors", "warnings", "mapped", "raw"];
  const lines = [header.map(csvCell).join(",")];
  rows.forEach((row) => {
    lines.push([
      batch.batch_id,
      batch.source_type,
      row.index,
      (row.errors || []).join("; "),
      (row.warnings || []).join("; "),
      row.mapped || {},
      row.raw || {},
    ].map(csvCell).join(","));
  });
  return `${lines.join("\n")}\n`;
}

function latestBatchForHash(data, sourceType, hash) {
  return ensureBatches(data).find((batch) => batch.source_type === sourceType && batch.content_hash === hash) || null;
}

function previewImport(data, body = {}) {
  const sourceType = normalizeSourceType(body.sourceType || body.source_type);
  const { input } = inputFromBody(body);
  const hash = contentHash(sourceType, input);
  const existing = latestBatchForHash(data, sourceType, hash);
  if (existing && existing.status === "CONFIRMED") {
    return publicBatch(existing);
  }

  const preview = externalAdapterSamples.previewExternalSamples(data, sourceType, input);
  const review = externalAdapterSamples.recordExternalSampleReview(data, "IMPORT_PREVIEW", preview);
  const batch = existing || {
    batch_id: createId("imp"),
    source_type: sourceType,
    content_hash: hash,
    status: "PREVIEWED",
    created_at: nowISO(),
  };
  batch.input = input;
  batch.input_kind = Array.isArray(input) ? "samples" : "text";
  batch.file_summary = fileSummary(body, input, preview);
  batch.preview = { ...preview, review };
  batch.error_message = "";
  batch.updated_at = nowISO();
  if (!existing) ensureBatches(data).unshift(batch);
  return publicBatch(batch);
}

function getImportBatch(data, batchId) {
  const batch = ensureBatches(data).find((item) => item.batch_id === batchId);
  if (!batch) throw importError(4103, "导入批次不存在", 404);
  return publicBatch(batch);
}

function listImportBatches(data, query = {}) {
  const sourceType = query.sourceType || query.source_type || "";
  const date = query.date || "";
  const limit = Math.max(1, Math.min(Number(query.limit || 20), 100));
  return ensureBatches(data)
    .filter((batch) => !sourceType || batch.source_type === normalizeSourceType(sourceType))
    .filter((batch) => !date || String(batch.updated_at || batch.created_at || "").startsWith(date))
    .slice(0, limit)
    .map(publicBatch);
}

function confirmImport(data, batchId, options = {}) {
  const batch = ensureBatches(data).find((item) => item.batch_id === batchId);
  if (!batch) throw importError(4103, "导入批次不存在", 404);
  if (batch.status === "CONFIRMED") return publicBatch(batch);
  if (batch.status !== "PREVIEWED") throw importError(4104, "当前批次不可确认导入");

  const result = externalAdapterSamples.importExternalSamples(data, batch.source_type, batch.input, options.dateText);
  const review = externalAdapterSamples.recordExternalSampleReview(data, "IMPORT_CONFIRM", result);
  batch.status = "CONFIRMED";
  batch.result = { ...result, review };
  batch.confirmed_at = nowISO();
  batch.updated_at = nowISO();
  batch.confirmed_by = options.operatorId || "";
  return publicBatch(batch);
}

module.exports = {
  confirmImport,
  exportFailureRowsCsv,
  getImportBatch,
  listImportBatches,
  previewImport,
};
