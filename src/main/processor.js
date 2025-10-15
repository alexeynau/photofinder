const fs = require('fs');
const path = require('path');

const {
  analyzeText,
  DEFAULT_PREFIX,
} = require('../common/parser');

const fsp = fs.promises;

const VALID_MODES = new Set(['copy', 'move', 'simulate']);
const DEFAULT_SELECTION_FOLDER = 'Выбор';

const toAbsolute = (inputPath) => path.resolve(inputPath);

const ensureDirectoryExists = async (dirPath) => {
  await fsp.mkdir(dirPath, { recursive: true });
};

const buildFilePattern = (prefix = DEFAULT_PREFIX) => {
  if (!prefix) {
    return /^(\d{4})\.(.+)$/i;
  }
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}_(\\d{4})\\.(.+)$`, 'i');
};

const indexSourceFiles = async (sourceDir, prefix = DEFAULT_PREFIX) => {
  const entries = await fsp.readdir(sourceDir, { withFileTypes: true });
  const index = new Map();
  const filePattern = buildFilePattern(prefix);

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const match = entry.name.match(filePattern);
    if (!match) {
      continue;
    }

    const [, id] = match;
    const absolutePath = path.join(sourceDir, entry.name);
    const info = {
      id,
      name: entry.name,
      absolutePath,
    };

    if (!index.has(id)) {
      index.set(id, []);
    }
    index.get(id).push(info);
  }

  return index;
};

const pathExists = async (candidate) => {
  try {
    await fsp.access(candidate, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const resolveDestinationPath = async (targetDir, fileName) => {
  let candidate = path.join(targetDir, fileName);
  if (!(await pathExists(candidate))) {
    return candidate;
  }

  const { name, ext } = path.parse(fileName);
  let counter = 1;
  while (true) {
    const nextName = `${name} (${counter})${ext}`;
    candidate = path.join(targetDir, nextName);
    if (!(await pathExists(candidate))) {
      return candidate;
    }
    counter += 1;
  }
};

const performOperation = async (mode, fileInfo, targetDir) => {
  if (mode === 'simulate') {
    return {
      outcome: 'simulated',
      destination: path.join(targetDir, fileInfo.name),
    };
  }

  await ensureDirectoryExists(targetDir);
  const destinationPath = await resolveDestinationPath(targetDir, fileInfo.name);

  if (mode === 'copy') {
    await fsp.copyFile(fileInfo.absolutePath, destinationPath);
    return {
      outcome: 'copied',
      destination: destinationPath,
    };
  }

  if (mode === 'move') {
    try {
      await fsp.rename(fileInfo.absolutePath, destinationPath);
    } catch (error) {
      if (error.code === 'EXDEV') {
        await fsp.copyFile(fileInfo.absolutePath, destinationPath);
        await fsp.unlink(fileInfo.absolutePath);
      } else {
        throw error;
      }
    }

    return {
      outcome: 'moved',
      destination: destinationPath,
    };
  }

  throw new Error(`Неизвестный режим: ${mode}`);
};

const summarize = (mode, processedCount, missingCount) => {
  const actions =
    mode === 'copy'
      ? 'скопированы'
      : mode === 'move'
        ? 'перемещены'
        : 'проверены';

  return `Режим: ${actions}. Обработано записей: ${processedCount}. Не найдено: ${missingCount}.`;
};

const DEFAULT_PARSER_MODE = 'smart';
const VALID_PARSER_MODES = new Set(['smart', 'simple']);

const processPhotos = async ({
  sourceDir,
  targetDir,
  message,
  mode,
  parserMode = DEFAULT_PARSER_MODE,
  prefix = DEFAULT_PREFIX,
}) => {
  if (!VALID_MODES.has(mode)) {
    return {
      ok: false,
      error: `Недопустимый режим: ${mode}`,
    };
  }

  if (!sourceDir) {
    return {
      ok: false,
      error: 'Укажите папку-источник.',
    };
  }

  if (!message || !message.trim()) {
    return {
      ok: false,
      error: 'Текст с номерами пуст. Вставьте сообщение и повторите попытку.',
    };
  }

  if (!VALID_PARSER_MODES.has(parserMode)) {
    return {
      ok: false,
      error: `Недопустимый режим парсера: ${parserMode}`,
    };
  }

  const sourcePath = toAbsolute(sourceDir);
  const effectivePrefix = prefix || DEFAULT_PREFIX;
  const resolvedTarget =
    targetDir && targetDir.trim().length > 0
      ? targetDir
      : path.join(sourcePath, DEFAULT_SELECTION_FOLDER);
  const targetPath = toAbsolute(resolvedTarget);

  try {
    const [sourceStats, targetStats] = await Promise.allSettled([
      fsp.stat(sourcePath),
      fsp.stat(targetPath),
    ]);

    if (
      sourceStats.status !== 'fulfilled' ||
      !sourceStats.value.isDirectory()
    ) {
      return {
        ok: false,
        error: `Папка источника недоступна или не существует: ${sourcePath}`,
      };
    }

    if (
      targetStats.status === 'fulfilled' &&
      !targetStats.value.isDirectory()
    ) {
      return {
        ok: false,
        error: `Путь назначения существует и не является папкой: ${targetPath}`,
      };
    }
  } catch (statError) {
    return {
      ok: false,
      error: `Ошибка проверки путей: ${(statError && statError.message) || statError}`,
    };
  }

  const analysis = analyzeText(message, {
    mode: parserMode,
    prefix: effectivePrefix,
  });
  const ids = analysis.ids;

  if (ids.length === 0) {
    return {
      ok: false,
      error: 'Идентификаторы фотографий не найдены. Проверьте текст сообщения.',
    };
  }

  const sourceIndex = await indexSourceFiles(sourcePath, effectivePrefix);

  const processedEntries = [];
  const missingIds = [];

  for (const id of ids) {
    const candidates = sourceIndex.get(id);
    if (!candidates || candidates.length === 0) {
      const missingLabel = effectivePrefix
        ? `${effectivePrefix}_${id}`
        : id;
      missingIds.push(missingLabel);
      continue;
    }

    for (const candidate of candidates) {
      const operationResult = await performOperation(mode, candidate, targetPath);
      const label =
        operationResult.outcome === 'simulated'
          ? 'Проверено'
          : operationResult.outcome === 'copied'
            ? 'Скопировано'
            : 'Перемещено';

      processedEntries.push(`${label}: ${candidate.name}`);
    }
  }

  return {
    ok: true,
    mode,
    parserMode,
    processed: processedEntries,
    missing: missingIds,
    details: summarize(mode, processedEntries.length, missingIds.length),
    resolvedTargetDir: targetPath,
    extractedIds: ids,
    matches: analysis.matches,
    prefix: effectivePrefix,
  };
};

module.exports = {
  processPhotos,
  buildFilePattern,
  DEFAULT_SELECTION_FOLDER,
};
