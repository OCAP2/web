/**
 * Compile MapLibre GL style expressions into JS accessor functions.
 *
 * Each compiled expression is a function (properties, zoom) => value.
 * Only the operators actually used by styles.go are implemented.
 */

export type ExprFn = (properties: Record<string, any>, zoom: number) => any;

/**
 * Parse a CSS color string to an [r, g, b, a] array (0-255).
 * Handles #hex (3/6/8 digit), rgb(), rgba().
 */
export function parseCssColor(value: string): [number, number, number, number] {
  if (typeof value !== "string") return [0, 0, 0, 255];

  // #RGB, #RRGGBB, #RRGGBBAA
  if (value.startsWith("#")) {
    const h = value.slice(1);
    if (h.length === 3) {
      return [
        parseInt(h[0] + h[0], 16),
        parseInt(h[1] + h[1], 16),
        parseInt(h[2] + h[2], 16),
        255,
      ];
    }
    if (h.length >= 6) {
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255;
      return [r, g, b, a];
    }
  }

  // rgb(r, g, b) or rgba(r, g, b, a)
  const m = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (m) {
    return [
      parseInt(m[1], 10),
      parseInt(m[2], 10),
      parseInt(m[3], 10),
      m[4] !== undefined ? Math.round(parseFloat(m[4]) * 255) : 255,
    ];
  }

  return [0, 0, 0, 255];
}

/**
 * Compile a MapLibre expression (or literal) to a JS function.
 */
export function compileExpression(expr: any): ExprFn {
  // null/undefined → identity
  if (expr === null || expr === undefined) {
    return () => undefined;
  }

  // Literal values (string, number, boolean)
  if (typeof expr !== "object" || !Array.isArray(expr)) {
    return () => expr;
  }

  const [op, ...args] = expr;

  switch (op) {
    case "literal":
      return () => args[0];

    case "get":
      return (props) => props[args[0]];

    case "zoom":
      return (_props, zoom) => zoom;

    case "case": {
      // ["case", cond1, val1, cond2, val2, ..., fallback]
      const pairs: Array<{ cond: ExprFn; val: ExprFn }> = [];
      let i = 0;
      while (i < args.length - 1) {
        pairs.push({
          cond: compileExpression(args[i]),
          val: compileExpression(args[i + 1]),
        });
        i += 2;
      }
      const fallback = compileExpression(args[args.length - 1]);
      return (props, zoom) => {
        for (const pair of pairs) {
          if (pair.cond(props, zoom)) return pair.val(props, zoom);
        }
        return fallback(props, zoom);
      };
    }

    // Comparisons
    case "<": {
      const a = compileExpression(args[0]);
      const b = compileExpression(args[1]);
      return (props, zoom) => a(props, zoom) < b(props, zoom);
    }
    case "<=": {
      const a = compileExpression(args[0]);
      const b = compileExpression(args[1]);
      return (props, zoom) => a(props, zoom) <= b(props, zoom);
    }
    case ">": {
      const a = compileExpression(args[0]);
      const b = compileExpression(args[1]);
      return (props, zoom) => a(props, zoom) > b(props, zoom);
    }
    case ">=": {
      const a = compileExpression(args[0]);
      const b = compileExpression(args[1]);
      return (props, zoom) => a(props, zoom) >= b(props, zoom);
    }
    case "==": {
      const a = compileExpression(args[0]);
      const b = compileExpression(args[1]);
      return (props, zoom) => a(props, zoom) == b(props, zoom);
    }
    case "!=": {
      const a = compileExpression(args[0]);
      const b = compileExpression(args[1]);
      return (props, zoom) => a(props, zoom) != b(props, zoom);
    }

    // Interpolation
    case "interpolate": {
      const interpType = args[0]; // ["linear"] or ["exponential", base]
      const input = compileExpression(args[1]);
      const stops: Array<{ z: number; val: ExprFn }> = [];
      for (let i = 2; i < args.length; i += 2) {
        stops.push({ z: args[i] as number, val: compileExpression(args[i + 1]) });
      }

      let base = 1;
      if (Array.isArray(interpType) && interpType[0] === "exponential") {
        base = interpType[1] ?? 1;
      }

      return (props, zoom) => {
        const t = input(props, zoom);
        if (stops.length === 0) return 0;
        if (t <= stops[0].z) return stops[0].val(props, zoom);
        if (t >= stops[stops.length - 1].z) return stops[stops.length - 1].val(props, zoom);

        // Find the two surrounding stops
        let lo = 0;
        for (let i = 1; i < stops.length; i++) {
          if (t < stops[i].z) { lo = i - 1; break; }
          lo = i;
        }
        const hi = lo + 1;
        if (hi >= stops.length) return stops[lo].val(props, zoom);

        const zLo = stops[lo].z;
        const zHi = stops[hi].z;
        const range = zHi - zLo;

        let frac: number;
        if (base === 1) {
          frac = (t - zLo) / range;
        } else {
          frac = (Math.pow(base, t - zLo) - 1) / (Math.pow(base, range) - 1);
        }

        const vLo = stops[lo].val(props, zoom);
        const vHi = stops[hi].val(props, zoom);

        if (typeof vLo === "number" && typeof vHi === "number") {
          return vLo + frac * (vHi - vLo);
        }
        // For non-numeric stops, snap to lower
        return frac < 0.5 ? vLo : vHi;
      };
    }

    // Arithmetic
    case "*": {
      const operands = args.map(compileExpression);
      return (props, zoom) =>
        operands.reduce((acc, fn) => acc * fn(props, zoom), 1);
    }
    case "/": {
      const a = compileExpression(args[0]);
      const b = compileExpression(args[1]);
      return (props, zoom) => {
        const denom = b(props, zoom);
        return denom === 0 ? 0 : a(props, zoom) / denom;
      };
    }
    case "+": {
      const operands = args.map(compileExpression);
      return (props, zoom) =>
        operands.reduce((acc, fn) => acc + fn(props, zoom), 0);
    }
    case "-": {
      const a = compileExpression(args[0]);
      const b = args.length > 1 ? compileExpression(args[1]) : null;
      return (props, zoom) =>
        b ? a(props, zoom) - b(props, zoom) : -a(props, zoom);
    }

    // String
    case "concat": {
      const parts = args.map(compileExpression);
      return (props, zoom) => parts.map((fn) => fn(props, zoom)).join("");
    }
    case "to-string": {
      const val = compileExpression(args[0]);
      return (props, zoom) => String(val(props, zoom) ?? "");
    }

    // Math
    case "round": {
      const val = compileExpression(args[0]);
      return (props, zoom) => Math.round(val(props, zoom));
    }

    // Decision
    case "coalesce": {
      const fns = args.map(compileExpression);
      return (props, zoom) => {
        for (const fn of fns) {
          const v = fn(props, zoom);
          if (v !== null && v !== undefined) return v;
        }
        return null;
      };
    }

    default:
      // Unknown expression — return undefined
      return () => undefined;
  }
}

/**
 * Compile a MapLibre filter expression.
 *
 * Handles both new expression syntax (["op", ...]) and legacy filter syntax
 * like ["==", "type", "minor"] where bare strings are property names.
 */
export function compileFilter(filter: any): ExprFn | undefined {
  if (!filter || !Array.isArray(filter)) return undefined;

  const op = filter[0];

  // Logical combinators
  if (op === "all") {
    const fns = filter.slice(1).map(compileFilter).filter(Boolean) as ExprFn[];
    return (props, zoom) => fns.every((fn) => fn(props, zoom));
  }
  if (op === "any") {
    const fns = filter.slice(1).map(compileFilter).filter(Boolean) as ExprFn[];
    return (props, zoom) => fns.some((fn) => fn(props, zoom));
  }
  if (op === "none") {
    const fns = filter.slice(1).map(compileFilter).filter(Boolean) as ExprFn[];
    return (props, zoom) => !fns.some((fn) => fn(props, zoom));
  }

  // Legacy filter format: ["==", "propertyName", value]
  // Distinguished from expression format by second argument being a bare string
  if (
    (op === "==" || op === "!=" || op === "<" || op === "<=" || op === ">" || op === ">=") &&
    filter.length === 3 &&
    typeof filter[1] === "string" &&
    !Array.isArray(filter[1])
  ) {
    // Check if second arg looks like an expression array — if not, it's a legacy prop name
    const propOrExpr = filter[1];
    const value = filter[2];
    // If the second argument is a plain string (not "get"/"zoom" etc.), treat as legacy
    if (!Array.isArray(propOrExpr)) {
      const compiledValue = compileExpression(value);
      switch (op) {
        case "==": return (props, zoom) => props[propOrExpr] == compiledValue(props, zoom);
        case "!=": return (props, zoom) => props[propOrExpr] != compiledValue(props, zoom);
        case "<": return (props, zoom) => props[propOrExpr] < compiledValue(props, zoom);
        case "<=": return (props, zoom) => props[propOrExpr] <= compiledValue(props, zoom);
        case ">": return (props, zoom) => props[propOrExpr] > compiledValue(props, zoom);
        case ">=": return (props, zoom) => props[propOrExpr] >= compiledValue(props, zoom);
      }
    }
  }

  // New expression-based filter — compile normally
  return compileExpression(filter);
}
