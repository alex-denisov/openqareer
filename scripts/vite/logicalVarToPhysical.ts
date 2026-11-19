import type { Plugin } from 'postcss';

/**
 * The .app window runs on the system WebKit of macOS 26 (Safari 27 has a newer
 * one of its own). There, under the B640 barrier `all: revert-layer`
 * (styles/layers.css), a logical shorthand whose value holds `var()` comes out
 * as its initial value: `padding-inline: var(--career-space-3)` gives 0,
 * the same for padding-block, margin-*, inset-*, scroll-*, border-inline/block.
 * Longhands and physical properties are not affected. The cabinet is LTR and
 * horizontal only, so these declarations are rewritten to physical sides at
 * build time. Only files of src/features/b640 are touched: other styles use
 * vertical writing modes in places, and the barrier does not apply to them.
 */

type Pair = readonly [property: string, value: string];

const SIDES = { inline: ['left', 'right'], block: ['top', 'bottom'] } as const;
type Axis = keyof typeof SIDES;

const BOX = /^(padding|margin|scroll-padding|scroll-margin)-(inline|block)$/u;
const INSET = /^inset-(inline|block)$/u;
const BORDER_AXIS = /^border-(inline|block)$/u;
const BORDER_SIDE = /^border-(inline|block)-(start|end)$/u;
const BORDER_PART = /^border-(inline|block)-(width|style|color)$/u;

/** A declaration the system WebKit drops under `revert-layer`; for tests and the e2e guard. */
export const B640_LOGICAL_VAR_SHORTHAND =
  /(?:^|[\s;{])(?:(?:padding|margin|scroll-padding|scroll-margin|inset)-(?:inline|block)|border-(?:inline|block)(?:-(?:start|end|width|style|color))?)\s*:[^;}]*var\(/u;

const B640_SOURCE = /[\\/]src[\\/]features[\\/]b640[\\/]/u;

/** Top-level values separated by whitespace, parentheses kept whole. */
function topLevelValues(value: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value.trim()) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (/\s/u.test(char) && depth === 0) {
      if (current) parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  return current ? [...parts, current] : parts;
}

function startEnd(axis: Axis, value: string, name: (side: string) => string): Pair[] | null {
  const values = topLevelValues(value);
  if (values.length < 1 || values.length > 2) return null;
  const [start, end] = SIDES[axis];
  return [
    [name(start), values[0] ?? ''],
    [name(end), values[1] ?? values[0] ?? ''],
  ];
}

/** Physical declarations for a logical shorthand with `var()`, or null to keep it. */
export function physicalDeclarations(property: string, value: string): Pair[] | null {
  if (!value.includes('var(')) return null;
  const box = BOX.exec(property);
  if (box) return startEnd(box[2] as Axis, value, (side) => `${box[1]}-${side}`);
  const inset = INSET.exec(property);
  if (inset) return startEnd(inset[1] as Axis, value, (side) => side);
  const axis = BORDER_AXIS.exec(property);
  if (axis) return SIDES[axis[1] as Axis].map((side): Pair => [`border-${side}`, value]);
  const side = BORDER_SIDE.exec(property);
  if (side) {
    const [start, end] = SIDES[side[1] as Axis];
    return [[`border-${side[2] === 'start' ? start : end}`, value]];
  }
  const part = BORDER_PART.exec(property);
  if (part) return startEnd(part[1] as Axis, value, (name) => `border-${name}-${part[2]}`);
  return null;
}

export function logicalVarToPhysical(): Plugin {
  return {
    postcssPlugin: 'b640-logical-var-to-physical',
    Once(root) {
      const file = root.source?.input.file ?? '';
      if (!B640_SOURCE.test(file)) return;
      root.walkDecls((declaration) => {
        const pairs = physicalDeclarations(declaration.prop, declaration.value);
        if (!pairs) return;
        for (const [prop, value] of pairs) {
          declaration.cloneBefore({ prop, value, important: declaration.important });
        }
        declaration.remove();
      });
    },
  };
}
