const PHONE_PATTERN = /(?:\+?7|8)(?:[\s()-]*\d){10}/g;
const DATE_PATTERN =
  /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b/g;
const CONTRACT_PATTERN = /(?:№|NO\.?|N\.)\s*\d{3,5}/gi;

const GENERIC_NUMBER_PATTERN = /\d{3,4}/g;
const DEFAULT_PREFIX = 'IMG';

const isDigit = (char) => /\d/.test(char);

const escapeRegex = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildPrefixPattern = (prefix) => {
  if (!prefix) {
    return null;
  }
  const escaped = escapeRegex(prefix);
  return new RegExp(`${escaped}[\\s_\\-/]?(\\d{3,4})`, 'gi');
};

const collectRanges = (text, regex) => {
  const ranges = [];
  if (!regex.global) {
    const clone = new RegExp(regex.source, regex.flags + 'g');
    return collectRanges(text, clone);
  }

  regex.lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
};

const isWithinRanges = (start, end, ranges) =>
  ranges.some(([rangeStart, rangeEnd]) => start >= rangeStart && end <= rangeEnd);

const normalizeId = (digits) =>
  digits.length === 3 ? `0${digits}` : digits.padStart(4, '0');

const shouldSkipByContext = (text, start, end) => {
  const prefix = text.slice(Math.max(0, start - 4), start).toUpperCase();
  if (
    /№\s*$/.test(prefix) ||
    /N\s*O\s*\.?\s*$/.test(prefix) ||
    /N\s*\.\s*$/.test(prefix)
  ) {
    return true;
  }

  const suffix = text.slice(end, Math.min(text.length, end + 5)).toUpperCase();
  if (/^\s*(ГОД|YEAR)(?=\W|$)/.test(suffix)) {
    return true;
  }

  return false;
};

const createCollector = () => {
  const unique = new Set();
  const ordered = [];

  return {
    add: (id) => {
      if (!unique.has(id)) {
        unique.add(id);
        ordered.push(id);
      }
    },
    result: () => ordered,
  };
};

const analyzeText = (
  text,
  { mode = 'smart', prefix = DEFAULT_PREFIX } = {}
) => {
  if (!text || typeof text !== 'string') {
    return { ids: [], matches: [] };
  }

  const normalizedMode = mode === 'simple' ? 'simple' : 'smart';
  const originalText = text;
  const upperText = originalText.toUpperCase();

  const collector = createCollector();
  const matches = [];
  const addMatch = ({
    digits,
    matchStart,
    matchEnd,
    highlightStart = matchStart,
    highlightEnd = matchEnd,
    raw,
  }) => {
    const normalized = normalizeId(digits);
    matches.push({
      id: normalized,
      start: highlightStart,
      end: highlightEnd,
      raw,
      matchStart,
      matchEnd,
    });
    collector.add(normalized);
  };

  const prefixPattern = buildPrefixPattern(prefix);
  const takenRanges = [];

  if (prefixPattern) {
    prefixPattern.lastIndex = 0;
    let prefixMatch;
    while ((prefixMatch = prefixPattern.exec(upperText)) !== null) {
      const matchStart = prefixMatch.index;
      const matchEnd = matchStart + prefixMatch[0].length;
      const digits = prefixMatch[1];
      const raw = originalText.slice(matchStart, matchEnd);

      const digitsIndexInRaw = raw.toUpperCase().lastIndexOf(digits);
      const digitsOffset =
        digitsIndexInRaw !== -1 ? digitsIndexInRaw : raw.length - digits.length;
      const highlightStart = matchStart + digitsOffset;
      const highlightEnd = highlightStart + digits.length;

      addMatch({
        digits,
        matchStart,
        matchEnd,
        highlightStart,
        highlightEnd,
        raw,
      });
      takenRanges.push([matchStart, matchEnd]);
    }
  }

  const genericPattern = new RegExp(GENERIC_NUMBER_PATTERN.source, 'g');
  const exclusions =
    normalizedMode === 'smart'
      ? [
          ...collectRanges(upperText, PHONE_PATTERN),
          ...collectRanges(upperText, DATE_PATTERN),
          ...collectRanges(upperText, CONTRACT_PATTERN),
        ]
      : null;

  let genericMatch;
  while ((genericMatch = genericPattern.exec(upperText)) !== null) {
    const digits = genericMatch[0];
    const start = genericMatch.index;
    const end = start + digits.length;

    const charBefore = start > 0 ? upperText[start - 1] : '';
    const charAfter = end < upperText.length ? upperText[end] : '';

    if (isDigit(charBefore) || isDigit(charAfter)) {
      continue;
    }

    if (takenRanges.length > 0 && isWithinRanges(start, end, takenRanges)) {
      continue;
    }

    if (normalizedMode === 'smart') {
      if (exclusions && isWithinRanges(start, end, exclusions)) {
        continue;
      }

      if (shouldSkipByContext(upperText, start, end)) {
        continue;
      }
    }

    const raw = originalText.slice(start, end);
    addMatch({
      digits,
      matchStart: start,
      matchEnd: end,
      highlightStart: start,
      highlightEnd: end,
      raw,
    });
  }

  return {
    ids: collector.result(),
    matches,
  };
};

const extractPhotoIdsSimple = (text, options = {}) =>
  analyzeText(text, { ...options, mode: 'simple' }).ids;

const extractPhotoIdsSmart = (text, options = {}) =>
  analyzeText(text, { ...options, mode: 'smart' }).ids;

module.exports = {
  analyzeText,
  extractPhotoIdsSmart,
  extractPhotoIdsSimple,
  extractPhotoIds: extractPhotoIdsSmart,
  DEFAULT_PREFIX,
};
