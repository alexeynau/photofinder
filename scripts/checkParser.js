const fs = require('fs');
const path = require('path');

const {
  extractPhotoIdsSmart,
  extractPhotoIdsSimple,
} = require('../src/common/parser');

const args = process.argv.slice(2);
const filePathArg = args[0];
const modeArg = args[1];
const prefixArg = args[2];

const resolvedPath = filePathArg
  ? path.resolve(process.cwd(), filePathArg)
  : null;

if (!resolvedPath) {
  console.error('Укажите путь к файлу с текстом.');
  process.exit(1);
}

if (!fs.existsSync(resolvedPath)) {
  console.error(`Файл не найден: ${resolvedPath}`);
  process.exit(1);
}

const mode = (modeArg || 'smart').toLowerCase();
const parser =
  mode === 'simple' ? extractPhotoIdsSimple : extractPhotoIdsSmart;

if (mode !== 'smart' && mode !== 'simple') {
  console.warn(
    `Неизвестный режим "${modeArg}". Использую умный парсер (smart).`
  );
}

const options = {};
if (prefixArg) {
  options.prefix = prefixArg;
}

const content = fs.readFileSync(resolvedPath, 'utf8');
const ids = parser(content, options);

console.log(`Режим: ${mode === 'simple' ? 'глупый' : 'умный'}`);
if (prefixArg) {
  console.log(`Префикс: ${prefixArg}`);
}
console.log(`Извлечено ${ids.length} идентификаторов:`);
ids.forEach((id) => console.log(`- ${id}`));
