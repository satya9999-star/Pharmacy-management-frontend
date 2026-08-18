function isHeaderOrFooterJunkLine(line) {
  if (!line) return true;
  const upper = line.trim().toUpperCase();
  const junkKeywords = [
    'SUJATHA MEDICAL', 'MEDICAL AGENCIES', 'THATAKULAVARI', 'VIJAYAWADA',
    'PH:', 'PHONE', 'GST INVOICE', 'GSTIN', 'DL NO', 'DL.NO', 'DL NO1', 'DL NO2',
    'HPR NO', 'HFR NO', 'ADR NO', 'INV NO', 'INVOICE NO', 'BILL TYPE', 'CREDIT',
    'LAKSHMI MEDICAL', 'MAKKAPETA', 'CUSTOMER', 'PLACE OF SUPPLY', 'TERMS',
    'TOTAL DUE', 'SUB TOTAL', 'LESS DISC', 'GST AMT', 'NET PAYABLE', 'TAXABLE',
    'CGST', 'SGST', 'ROUNDING', 'IN WORDS', 'AUTHORISED', 'SIGNATORY', 'BANK :',
    'GOODS SUPPLIED', 'JURISDICTION', 'MFG HSN CODE', 'PRODUCT NAME', 'BATCH NO EXPIRY'
  ];
  for (const kw of junkKeywords) {
    if (upper.includes(kw)) return true;
  }
  return false;
}

function parseSingleBillTextLine(line) {
  let trimmed = line.trim();
  if (!trimmed) return null;
  if (isHeaderOrFooterJunkLine(trimmed)) return null;
  if (/\bAP\/\d+|\bDL\s*NO|\bLICENSE|\bHPR\s*NO|\bHFR\s*NO|\bADR\s*NO/i.test(trimmed)) return null;

  // Clean leading OCR margin artifacts like "i ", "1 ", "| "
  trimmed = trimmed.replace(/^[iI1\|\.\,\s]+\s+(?=[A-Za-z])/i, '');

  // Expiry date regex: matches valid medicine expiry month 01-12 and year (accepts OCR separators like /, -, ., l, I, |, spaces)
  const dateRegex = /(0[1-9]|1[0-2])[\-\/\u2013\u2014\\_\s\.\,lIi|]+(20[2-3][0-9]|[2-3][0-9])\b/;
  const dateMatch = trimmed.match(dateRegex);
  if (!dateMatch) return null;

  const expiryDateRaw = dateMatch[0].trim();
  const rawDateBits = expiryDateRaw.split(/[\-\/\u2013\u2014\\_\s\.\,lIi|]+/);
  if (rawDateBits.length < 2) return null;
  let expYear = parseInt(rawDateBits[1], 10);
  if (expYear < 100) expYear += 2000;
  
  // Medicine expiry MUST be in the future (>= 2026). Reject past DL / registration dates (like 2023, 2022)
  const currentYear = 2026;
  if (expYear < currentYear || expYear > currentYear + 15) return null;

  const dateIdx = trimmed.indexOf(expiryDateRaw);
  const beforeDate = trimmed.substring(0, dateIdx).trim();
  const afterDate = trimmed.substring(dateIdx + expiryDateRaw.length).trim();

  const beforeParts = beforeDate.split(/\s+/).filter(Boolean);
  if (beforeParts.length < 2) return null;

  let batchNo = beforeParts[beforeParts.length - 1];
  const revMatch = batchNo.match(/^(\d+)([A-Z]+[\-\/\_])$/i);
  if (revMatch) {
    batchNo = revMatch[2] + revMatch[1];
  } else {
    const revMatch2 = batchNo.match(/^(\d+)([A-Z]+)$/i);
    if (revMatch2) {
      batchNo = revMatch2[2] + '-' + revMatch2[1];
    }
  }

  let tokens = beforeParts.slice(0, beforeParts.length - 1);

  if (tokens.length > 0 && /^\d{1,2}$/.test(tokens[0])) {
    tokens.shift();
  }

  let manufacturer = 'Unknown';
  let hsnCode = '300490';

  // 1. Check for concatenated Mfg & HSN (e.g. BIOCHE30049083, SEMUNS90211000, MICRO30049069, iBIOCHE30049083)
  if (tokens.length >= 1) {
    const cleanedToken = tokens[0].replace(/^[iI1]+(?=[A-Za-z]{3,})/i, '');
    const concatMatch = cleanedToken.match(/^([A-Za-z]{2,8})(\d{4,8})$/i);
    if (concatMatch) {
      manufacturer = concatMatch[1];
      hsnCode = concatMatch[2];
      tokens = tokens.slice(1);
    }
  }

  if (manufacturer === 'Unknown' && tokens.length >= 2 && /^[A-Za-z]{3,}$/.test(tokens[0]) && /^\d{4,8}$/.test(tokens[1])) {
    manufacturer = tokens[0];
    hsnCode = tokens[1];
    tokens = tokens.slice(2);
  } else if (hsnCode === '300490' && tokens.length >= 1 && /^\d{4,8}$/.test(tokens[0])) {
    hsnCode = tokens[0];
    tokens = tokens.slice(1);
  }

  let category = 'General';
  let medicineName = '';

  const packRegex = /^(?:\d+\s*)?(?:3ml|5ml|10ml|100ml|50ml|2ml|10s|10's|10ta|10tab|10cap|10caps|10gm|15gm|100mg|500mg|each|s|m|l|xl|1x10|10x10|1amp|ta|tab|tabs|cap|caps|gm|ml|mg|pcs|nos|vial|amp)$/i;

  if (tokens.length >= 2) {
    const lastToken = tokens[tokens.length - 1].trim();
    const prevToken = tokens[tokens.length - 2].trim();
    const combined = (prevToken + ' ' + lastToken).trim();

    if (/^\d+\s*(?:TA|TAB|TABS|CAP|CAPS|GM|ML|MG|S|NOS|PCS|VIAL|AMP)$/i.test(combined)) {
      category = combined;
      medicineName = tokens.slice(0, tokens.length - 2).join(' ');
    } else if (packRegex.test(lastToken)) {
      if (/^\d+$/.test(prevToken)) {
        category = prevToken + ' ' + lastToken;
        medicineName = tokens.slice(0, tokens.length - 2).join(' ');
      } else {
        category = lastToken;
        medicineName = tokens.slice(0, tokens.length - 1).join(' ');
      }
    } else if (/^(?:TA|TAB|TABS|CAP|CAPS|GM|ML|MG|S|NOS|PCS)$/i.test(lastToken)) {
      const numMatch = prevToken.match(/(\d+)$/);
      if (numMatch) {
        category = numMatch[1] + ' ' + lastToken;
        tokens[tokens.length - 2] = prevToken.substring(0, prevToken.length - numMatch[1].length).trim();
        medicineName = tokens.slice(0, tokens.length - 1).join(' ');
      } else {
        category = lastToken;
        medicineName = tokens.slice(0, tokens.length - 1).join(' ');
      }
    } else {
      medicineName = tokens.join(' ');
    }
  } else if (tokens.length === 1) {
    if (packRegex.test(tokens[0])) {
      category = tokens[0];
    } else {
      medicineName = tokens[0];
    }
  }

  medicineName = medicineName.replace(/^\d+[\s\-\/\.]*/, '').trim();
  if (!medicineName) return null;

  const mm = rawDateBits[0].padStart(2, '0');
  const expiryDate = `${expYear}-${mm}-28`;

  const afterParts = afterDate.split(/\s+/).filter(Boolean);
  let quantity = 0;
  let free = 0;
  let mrp = 0;
  let purchasePrice = 0;
  let gstPercentage = 12;

  const nums = afterParts.map(p => parseFloat(p.replace(/,/g, '').replace('%', ''))).filter(n => !isNaN(n));

  if (nums.length >= 5) {
    mrp = nums[0];
    quantity = Math.round(nums[1]);
    free = Math.round(nums[2]) || 0;
    purchasePrice = nums[3];
    if (mrp > 0 && purchasePrice > mrp * 2) {
      purchasePrice = purchasePrice / 100;
    }
    gstPercentage = nums[5] || 5;
  } else if (nums.length === 4) {
    quantity = Math.round(nums[0]);
    mrp = nums[1];
    purchasePrice = nums[2];
    if (mrp > 0 && purchasePrice > mrp * 2) {
      purchasePrice = purchasePrice / 100;
    }
    gstPercentage = nums[3] || 12;
  } else if (nums.length >= 2) {
    quantity = Math.round(nums[0]) || 10;
    mrp = nums[1] || 10;
    purchasePrice = nums[2] || mrp * 0.7;
    if (mrp > 0 && purchasePrice > mrp * 2) {
      purchasePrice = purchasePrice / 100;
    }
  }

  if (quantity <= 0) quantity = 10;
  if (purchasePrice <= 0) purchasePrice = mrp ? mrp * 0.7 : 10.00;
  if (mrp <= 0) mrp = purchasePrice * 1.25;

  let medicineCode = 'MED-' + medicineName.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 12);

  return {
    medicineCode,
    medicineName,
    manufacturer,
    hsnCode,
    category,
    batchNo,
    expiryDate,
    quantity,
    free,
    purchasePrice,
    mrp,
    gstPercentage
  };
}

const testLines = [
  "DORA 3004 DORA 3ML 3ml RA3036 11I28 8.44 100.0 0.0 2.30 230.00 5.0 0.0",
  "BIOCHE30049083 GLIMP-M1 TAB 10 TA SPA260036 12/27 109.13 15.0 0.0 11.00 165.00 5.0 0.0",
  "BIOCHE3004 GLIMP M2 TAB 10s SPA252945 11l27 198.70 20.0 0.0 12.00 240.00 5.0 0.0",
  "MICRO 30049069 RAPID GEL 10 GM 10 GM EB148 01.28 37.31 8.0 0.0 15.00 120.00 5.0 0.0",
  "SEMUNS90211000 SEMUNS WRIST BRACE THUMB each STU-011 12 28 153.00 5.0 0.0 65.00 325.00 5.0 0.0"
];

console.log("=== VERIFYING ALL 5 ROWS ===");
testLines.forEach((line, idx) => {
  const res = parseSingleBillTextLine(line);
  console.log(`Row #${idx + 1}: Mfg: "${res.manufacturer}", HSN: "${res.hsnCode}", Name: "${res.medicineName}", Pack: "${res.category}", Batch: "${res.batchNo}", Expiry: "${res.expiryDate}", Qty: ${res.quantity}, Rate: ${res.purchasePrice}`);
});
