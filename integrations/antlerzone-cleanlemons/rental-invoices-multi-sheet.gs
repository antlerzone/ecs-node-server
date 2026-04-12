/**
 * Antlerzone rental invoices — multi-sheet, global YYYYMMDDxx + PDF generation
 *
 * Setup:
 * 1. Sheet "PropertyDetail": Col A = tab name, B = default client (normal tabs), C = Drive folder URL
 * 2. Replace TEMPLATE_DOC_ID with your Google Doc template ID
 * 3. Run assignGlobalInvoiceNumbers() then generateInvoices_MULTI_SHEETS(),
 *    or runAssignThenGenerate() once
 *
 * Logs: View → Executions, or Extensions → Apps Script → Executions (full transcript).
 */

var TEMPLATE_DOC_ID = "105io1yLelshZW3PHabC_g_HZatGI18VqdZkzUS0jLCo";
var PROPERTY_DETAIL_NAME = "PropertyDetail";
var TZ = "GMT+8";
var CANCELLED_SHEET_NAME = "CANCELLED BOOKINGS";

/** Optional: set false to only assign numbers without PDFs */
var RUN_GENERATE_AFTER_ASSIGN = true;

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

function runAssignThenGenerate() {
  logSection("runAssignThenGenerate START");
  try {
    assignGlobalInvoiceNumbers();
    if (RUN_GENERATE_AFTER_ASSIGN) {
      generateInvoices_MULTI_SHEETS();
    } else {
      logLine("RUN_GENERATE_AFTER_ASSIGN=false → skip PDF generation");
    }
    logSection("runAssignThenGenerate DONE");
  } catch (e) {
    logError("runAssignThenGenerate FAILED", e);
    throw e;
  }
}

/**
 * Phase 1: Fill column I (invoice code) and J (month) for all rows that will get PDFs,
 * using one global sequence xx per calendar day (GMT+8) across every tab listed in PropertyDetail.
 */
function assignGlobalInvoiceNumbers() {
  logSection("assignGlobalInvoiceNumbers START");
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var propertySheet = ss.getSheetByName(PROPERTY_DETAIL_NAME);
  if (!propertySheet) {
    logError("PropertyDetail missing", new Error('No sheet "' + PROPERTY_DETAIL_NAME + '"'));
    throw new Error("Missing sheet: " + PROPERTY_DETAIL_NAME);
  }

  var propertyData = propertySheet.getDataRange().getValues();
  var jobs = [];

  for (var p = 1; p < propertyData.length; p++) {
    var sheetName = propertyData[p][0];
    if (!sheetName) {
      logLine("[ASSIGN] PropertyDetail row " + (p + 1) + ": skip (empty sheet name)");
      continue;
    }
    var sheet = ss.getSheetByName(String(sheetName).trim());
    if (!sheet) {
      logLine('[ASSIGN] PropertyDetail row ' + (p + 1) + ': skip (no tab "' + sheetName + '")');
      continue;
    }

    var data = sheet.getDataRange().getValues();
    var isCancelled = String(sheetName).trim() === CANCELLED_SHEET_NAME;
    logLine(
      '[ASSIGN] Scan tab="' +
        sheetName +
        '" rows=' +
        (data.length - 1) +
        " cancelled=" +
        isCancelled +
        " sheetOrder=" +
        p
    );

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var rowNum = i + 1;
      var existingCode = normalizeCell(row[8]);
      var doneVal = row[10];

      if (existingCode) {
        logLine("[ASSIGN] " + sheetName + " R" + rowNum + ": skip (I already has code: " + existingCode + ")");
        continue;
      }
      if (String(doneVal).trim().toLowerCase() === "done") {
        logLine("[ASSIGN] " + sheetName + " R" + rowNum + ": skip (K=done)");
        continue;
      }

      var periodRaw;
      var antlerValue;
      if (isCancelled) {
        periodRaw = row[3];
        antlerValue = getCancelledAntlerValue(row);
      } else {
        periodRaw = row[2];
        antlerValue = Number(row[7] || 0);
      }

      if (!antlerValue || antlerValue === 0) {
        logLine(
          "[ASSIGN] " + sheetName + " R" + rowNum + ": skip (antlerValue=0 periodRaw=" + String(periodRaw) + ")"
        );
        continue;
      }

      var parsedDate = parseDotDate(periodRaw, sheetName, rowNum);
      if (!parsedDate || isNaN(parsedDate.getTime())) {
        logLine("[ASSIGN] " + sheetName + " R" + rowNum + ": skip (bad date: " + String(periodRaw) + ")");
        continue;
      }

      jobs.push({
        sheet: sheet,
        sheetName: String(sheetName),
        rowNum: rowNum,
        parsedDate: parsedDate,
        sheetOrder: p,
        antlerValue: antlerValue,
      });
    }
  }

  logLine("[ASSIGN] Collected candidate rows: " + jobs.length);

  jobs.sort(function (a, b) {
    var da = yyyymmddGMT8(a.parsedDate);
    var db = yyyymmddGMT8(b.parsedDate);
    if (da !== db) return da < db ? -1 : 1;
    if (a.sheetOrder !== b.sheetOrder) return a.sheetOrder - b.sheetOrder;
    return a.rowNum - b.rowNum;
  });

  var countByDay = {};
  var assigned = 0;

  for (var j = 0; j < jobs.length; j++) {
    var job = jobs[j];
    var ymd = yyyymmddGMT8(job.parsedDate);
    countByDay[ymd] = (countByDay[ymd] || 0) + 1;
    var n = countByDay[ymd];
    if (n > 99) {
      logLine("[ASSIGN] WARNING: day " + ymd + " has " + n + " invoices — suffix exceeds 99, using 3 digits");
    }
    var xx = n <= 99 ? ("0" + n).slice(-2) : String(n);
    var code = ymd + xx;
    var monthYear = Utilities.formatDate(job.parsedDate, TZ, "MMM yyyy");

    job.sheet.getRange(job.rowNum, 9).setValue(code);
    job.sheet.getRange(job.rowNum, 10).setValue(monthYear);
    assigned++;

    logLine(
      "[ASSIGN] " +
        job.sheetName +
        " R" +
        job.rowNum +
        " → I=" +
        code +
        " J=" +
        monthYear +
        " (daySeq=" +
        n +
        " ymd=" +
        ymd +
        ")"
    );
  }

  logLine("[ASSIGN] Assigned invoice codes: " + assigned);
  logSection("assignGlobalInvoiceNumbers DONE");
}

function generateInvoices_MULTI_SHEETS() {
  logSection("generateInvoices_MULTI_SHEETS START");
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var propertySheet = ss.getSheetByName(PROPERTY_DETAIL_NAME);
  if (!propertySheet) {
    throw new Error("Missing sheet: " + PROPERTY_DETAIL_NAME);
  }

  var propertyData = propertySheet.getDataRange().getValues();
  var generated = 0;
  var skipped = 0;
  var errors = 0;

  for (var p = 1; p < propertyData.length; p++) {
    var sheetName = propertyData[p][0];
    var defaultClient = propertyData[p][1];
    var folderUrl = propertyData[p][2];

    if (!sheetName) {
      logLine("[GEN] PropertyDetail row " + (p + 1) + ": skip (empty sheet name)");
      continue;
    }

    var sheet = ss.getSheetByName(String(sheetName).trim());
    if (!sheet) {
      logLine('[GEN] PropertyDetail row ' + (p + 1) + ': skip (no tab "' + sheetName + '")');
      continue;
    }

    var folderId = extractFolderId(folderUrl);
    if (!folderId) {
      logLine('[GEN] tab="' + sheetName + '": skip (no folder id from PropertyDetail col C)');
      continue;
    }

    var data = sheet.getDataRange().getValues();
    var isCancelled = String(sheetName).trim() === CANCELLED_SHEET_NAME;
    logLine('[GEN] Tab="' + sheetName + '" rows=' + (data.length - 1) + " folderId=" + folderId);

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var rowNum = i + 1;

      var invoiceCode = normalizeCell(row[8]);
      var doneColumnNumber = 11;

      var periodRaw;
      var description;
      var antlerValue;
      var client;

      if (!isCancelled) {
        periodRaw = row[2];
        var gross = Number(row[4] || 0);
        var platform = Number(row[5] || 0);
        var net = Number(row[7] || 0);
        antlerValue = net;
        client = defaultClient;

        var parsedDate = parseDotDate(periodRaw, sheetName, rowNum);
        var periodText = Utilities.formatDate(parsedDate, TZ, "dd/MM/yyyy");
        var monthYear = Utilities.formatDate(parsedDate, TZ, "MMM yyyy");

        description =
          monthYear +
          ", " +
          sheetName +
          "\nGross Revenue: RM " +
          gross.toFixed(2) +
          "\nPlatform Fees: RM " +
          platform.toFixed(2) +
          "\nNet Profit: RM " +
          net.toFixed(2);
      } else {
        periodRaw = row[3];
        antlerValue = getCancelledAntlerValue(row);
        client = row[4];

        var parsedDateC = parseDotDate(periodRaw, sheetName, rowNum);
        var periodText = Utilities.formatDate(parsedDateC, TZ, "dd/MM/yyyy");
        var monthYear = Utilities.formatDate(parsedDateC, TZ, "MMM yyyy");
        var fNet = Number(row[5] || 0);
        var gPartial = Number(row[6] || 0);
        var hProfit = Number(row[7] || 0);

        description =
          monthYear +
          ", " +
          sheetName +
          " (Cancelled)" +
          "\nNet Revenue: RM " +
          fNet.toFixed(2) +
          "\nPartial Refund: RM " +
          gPartial.toFixed(2) +
          "\nCompany Profit: RM " +
          hProfit.toFixed(2) +
          "\nInvoiced Amount (H→F fallback): RM " +
          antlerValue.toFixed(2);
      }

      if (!invoiceCode) {
        logLine("[GEN] " + sheetName + " R" + rowNum + ": skip (empty I)");
        skipped++;
        continue;
      }
      if (sheet.getRange(rowNum, doneColumnNumber).getValue() === "done") {
        logLine("[GEN] " + sheetName + " R" + rowNum + ": skip (K=done)");
        skipped++;
        continue;
      }
      if (!antlerValue || antlerValue === 0) {
        logLine("[GEN] " + sheetName + " R" + rowNum + ": skip (antlerValue=0)");
        skipped++;
        continue;
      }

      var antlerText = "RM " + antlerValue.toFixed(2);
      var running = invoiceCode.toString().slice(-4);
      var filename = running + ", " + sheetName + " " + monthYear.toUpperCase() + ".pdf";

      logLine(
        "[GEN] " +
          sheetName +
          " R" +
          rowNum +
          " invoiceCode=" +
          invoiceCode +
          " file=" +
          filename
      );

      try {
        var copyId = DriveApp.getFileById(TEMPLATE_DOC_ID).makeCopy().getId();
        logLine("[GEN]   copy template → docId=" + copyId);

        var doc = DocumentApp.openById(copyId);
        var header = doc.getHeader();
        var body = doc.getBody();

        header.replaceText("{{invoiceCode}}", String(invoiceCode));
        header.replaceText("{{period}}", periodText);

        body.replaceText("{{description}}", description);
        body.replaceText("{{client}}", String(client || ""));
        body.replaceText("{{AntlerzoneInvoice}}", antlerText);

        doc.saveAndClose();

        var pdf = DriveApp.getFileById(copyId).getAs(MimeType.PDF);
        DriveApp.getFolderById(folderId).createFile(pdf.setName(filename));
        DriveApp.getFileById(copyId).setTrashed(true);

        sheet.getRange(rowNum, doneColumnNumber).setValue("done");
        generated++;
        logLine("[GEN]   OK PDF saved, K=done");
      } catch (e) {
        errors++;
        logError("[GEN]   FAILED row " + sheetName + " R" + rowNum, e);
      }

      Utilities.sleep(120);
    }
  }

  logLine("[GEN] Summary generated=" + generated + " skipped=" + skipped + " errors=" + errors);
  logSection("generateInvoices_MULTI_SHEETS DONE");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeCell(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function extractFolderId(url) {
  if (!url) return null;
  var match = String(url).match(/[-\w]{25,}/);
  return match ? match[0] : null;
}

/** Prefer H (company profit), else F (net revenue) */
function getCancelledAntlerValue(row) {
  var h = Number(row[7] || 0);
  if (h !== 0 && !isNaN(h)) return h;
  return Number(row[5] || 0);
}

function yyyymmddGMT8(date) {
  return Utilities.formatDate(date, TZ, "yyyyMMdd");
}

/**
 * Parse DD.MM.YYYY or Date; logs context on failure.
 */
function parseDotDate(value, sheetName, rowNum) {
  if (value instanceof Date) return value;
  if (!value) {
    logLine("[parseDotDate] " + (sheetName || "?") + " R" + (rowNum || "?") + ": empty → today (GMT+8)");
    return new Date();
  }
  var s = String(value).trim();
  var parts = s.split(".");
  if (parts.length !== 3) {
    var d = new Date(value);
    if (!isNaN(d.getTime())) return d;
    logLine("[parseDotDate] " + sheetName + " R" + rowNum + ": not DD.MM.YYYY, using new Date(value) fallback");
    return new Date(value);
  }
  var day = parseInt(parts[0], 10);
  var month = parseInt(parts[1], 10) - 1;
  var year = parseInt(parts[2], 10);
  return new Date(year, month, day);
}

function logSection(msg) {
  Logger.log("========== " + msg + " ==========");
}

function logLine(msg) {
  Logger.log(msg);
}

function logError(msg, e) {
  Logger.log("ERROR: " + msg);
  if (e && e.message) Logger.log("  message: " + e.message);
  if (e && e.stack) Logger.log("  stack: " + e.stack);
}
