function parseCurrentWidths(rawWidths, currentRoot) {
  if (!currentRoot) throw new Error('--current-widths must follow a --current-root.');
  if (!rawWidths) throw new Error('--current-widths requires a comma-separated list.');
  const widths = rawWidths.split(',').map((value) => Number(value.trim()));
  if (widths.some((width) => !Number.isInteger(width) || width <= 0)) {
    throw new Error('--current-widths must contain positive integer widths.');
  }
  currentRoot.widths = [...new Set(widths)];
}

function parseArgument(args, index, options) {
  const argument = args[index];
  if (argument === '--help' || argument === '-h') {
    options.help = true;
    return 0;
  }

  const nativeOptions = {
    '--native-root': 'nativeRoot',
    '--native-reference-root': 'nativeReferenceRoot',
    '--native-stage': 'nativeStage',
  };
  const nativeKey = nativeOptions[argument];
  if (nativeKey) {
    const value = args[index + 1];
    if (!value) throw new Error(`${argument} requires a value.`);
    options[nativeKey] = value;
    return 1;
  }
  if (argument === '--reference-root') {
    const value = args[index + 1];
    if (!value) throw new Error('--reference-root requires a directory path.');
    options.referenceRoot = value;
    return 1;
  }
  if (argument === '--current-root') {
    const value = args[index + 1];
    if (!value) throw new Error('--current-root requires a directory path.');
    options.currentRoots.push({ path: value, widths: null });
    return 1;
  }
  if (argument === '--current-widths') {
    parseCurrentWidths(args[index + 1], options.currentRoots.at(-1));
    return 1;
  }
  if (argument === '--current-stage') {
    const value = args[index + 1];
    if (!value) throw new Error('--current-stage requires a stage label.');
    options.currentStage = value;
    return 1;
  }
  throw new Error(`Unknown argument: ${argument}`);
}

function validateArguments(options) {
  if (!options.referenceRoot) throw new Error('Missing required --reference-root <dir>.');
  if (!['intermediate', 'unverified', 'final'].includes(options.currentStage)) {
    throw new Error('--current-stage must be intermediate, unverified, or final.');
  }
  if (Boolean(options.nativeRoot) !== Boolean(options.nativeReferenceRoot)) {
    throw new Error('--native-root and --native-reference-root must be provided together.');
  }
  if (!['intermediate', 'unverified', 'final'].includes(options.nativeStage)) {
    throw new Error('--native-stage must be intermediate, unverified, or final.');
  }
}

export function parseBlockAReviewArgs(args) {
  const options = {
    referenceRoot: undefined,
    currentRoots: [],
    currentStage: 'unverified',
    nativeRoot: undefined,
    nativeReferenceRoot: undefined,
    nativeStage: 'unverified',
  };

  for (let index = 0; index < args.length; index += 1) {
    index += parseArgument(args, index, options);
  }
  if (options.help) return options;
  validateArguments(options);
  return options;
}

export function showBlockAReviewHelp() {
  process.stdout.write(
    [
      'Usage:',
      '  node scripts/build-block-a-review.mjs --reference-root <dir> [--current-root <dir> [--current-widths <csv>] ...] [--current-stage intermediate|unverified|final]',
      '  [--native-root <dir> --native-reference-root <dir> --native-stage intermediate|unverified|final]',
      '',
      'Current roots are repeatable; --current-widths scopes the most recent root. Duplicate filenames are not paired.',
      'Native screenshots and web screenshots are copied byte-for-byte into output/block-a/review-assets with source paths and SHA-256 kept in the manifest.',
      'The script writes only output/block-a/review.html, review-manifest.json, and gallery assets beneath review-assets/.',
    ].join('\n') + '\n',
  );
}
