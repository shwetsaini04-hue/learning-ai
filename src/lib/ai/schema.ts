/**
 * A tiny, transparent schema system (think: a teaching-sized Pydantic).
 * We validate model output ourselves so the lab can SHOW you exactly why
 * a structured output failed — which is the heart of debugging LLM workflows.
 */

export type FieldSchema =
  | { type: "enum"; values: readonly string[]; description?: string; optional?: boolean }
  | { type: "number"; min?: number; max?: number; description?: string; optional?: boolean }
  | { type: "string"; minLength?: number; description?: string; optional?: boolean }
  | { type: "boolean"; description?: string; optional?: boolean }
  | { type: "string[]"; values?: readonly string[]; description?: string; optional?: boolean };

export type ObjectSchema = Record<string, FieldSchema>;

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  value?: Record<string, unknown>;
}

export function describeField(f: FieldSchema): string {
  switch (f.type) {
    case "enum":
      return f.values.map((v) => `"${v}"`).join(" | ");
    case "number":
      return `number${f.min !== undefined || f.max !== undefined ? ` (${f.min ?? "-∞"}..${f.max ?? "∞"})` : ""}`;
    case "string":
      return "string";
    case "boolean":
      return "boolean";
    case "string[]":
      return f.values ? `Array<${f.values.map((v) => `"${v}"`).join(" | ")}>` : "string[]";
  }
}

export function schemaToTypeString(schema: ObjectSchema, indent = "  "): string {
  const lines = Object.entries(schema).map(([k, f]) => `${indent}${k}${f.optional ? "?" : ""}: ${describeField(f)}`);
  return `{\n${lines.join(",\n")}\n}`;
}

export function schemaToJsonExample(schema: ObjectSchema): string {
  const obj: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(schema)) {
    if (f.type === "enum") obj[k] = f.values[0];
    else if (f.type === "number") obj[k] = f.max !== undefined && f.max <= 1 ? 0.9 : 3;
    else if (f.type === "boolean") obj[k] = true;
    else if (f.type === "string[]") obj[k] = f.values ? [f.values[0]] : ["..."];
    else obj[k] = "...";
  }
  return JSON.stringify(obj);
}

export function validate(value: unknown, schema: ObjectSchema): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, issues: [{ path: "$", message: `Expected a JSON object, received ${Array.isArray(value) ? "array" : typeof value}` }] };
  }
  const obj = value as Record<string, unknown>;
  for (const [key, f] of Object.entries(schema)) {
    const v = obj[key];
    if (v === undefined || v === null) {
      if (!f.optional) issues.push({ path: key, message: `Missing required field "${key}"` });
      continue;
    }
    switch (f.type) {
      case "enum":
        if (typeof v !== "string") issues.push({ path: key, message: `Expected string enum, received ${typeof v}` });
        else if (!f.values.includes(v)) issues.push({ path: key, message: `"${v}" is not one of ${f.values.map((x) => `"${x}"`).join(", ")}` });
        break;
      case "number":
        if (typeof v !== "number" || Number.isNaN(v)) issues.push({ path: key, message: `Expected number, received ${typeof v} (${JSON.stringify(v)})` });
        else {
          if (f.min !== undefined && v < f.min) issues.push({ path: key, message: `${v} is below minimum ${f.min}` });
          if (f.max !== undefined && v > f.max) issues.push({ path: key, message: `${v} is above maximum ${f.max}` });
        }
        break;
      case "string":
        if (typeof v !== "string") issues.push({ path: key, message: `Expected string, received ${typeof v}` });
        else if (f.minLength && v.length < f.minLength) issues.push({ path: key, message: `String shorter than ${f.minLength}` });
        break;
      case "boolean":
        if (typeof v !== "boolean") issues.push({ path: key, message: `Expected boolean, received ${typeof v}` });
        break;
      case "string[]":
        if (!Array.isArray(v)) issues.push({ path: key, message: `Expected array, received ${typeof v}` });
        else if (f.values) {
          const bad = v.filter((x) => typeof x !== "string" || !f.values!.includes(x));
          if (bad.length) issues.push({ path: key, message: `Unknown values: ${bad.map((b) => JSON.stringify(b)).join(", ")}` });
        }
        break;
    }
  }
  const extra = Object.keys(obj).filter((k) => !(k in schema));
  if (extra.length && issues.length) {
    issues.push({ path: extra.join(","), message: `Unexpected field(s): ${extra.join(", ")} (did the model rename a key?)` });
  }
  return { valid: issues.length === 0, issues, value: obj };
}

export interface ExtractResult {
  ok: boolean;
  value?: unknown;
  error?: string;
  /** what the extractor did, for teaching */
  steps: string[];
}

/**
 * Robust-ish JSON extraction, the way production parsers work:
 * 1) try raw JSON  2) strip ```json fences  3) take the first {...} block.
 */
export function extractJson(text: string): ExtractResult {
  const steps: string[] = [];
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Empty response (model returned no text — check max_tokens / reasoning budget)", steps };
  try {
    steps.push("Parsed raw text as JSON");
    return { ok: true, value: JSON.parse(trimmed), steps };
  } catch {
    steps.pop();
    steps.push("Raw text is not valid JSON");
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      const v = JSON.parse(fence[1].trim());
      steps.push("Stripped markdown ``` fences and parsed");
      return { ok: true, value: v, steps };
    } catch {
      steps.push("Found ``` fences but content is not valid JSON");
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const v = JSON.parse(trimmed.slice(start, end + 1));
      steps.push("Extracted the first {...} block from surrounding prose and parsed");
      return { ok: true, value: v, steps };
    } catch (e) {
      steps.push("Found a {...} block but it is not valid JSON");
      return { ok: false, error: `Malformed JSON: ${(e as Error).message}`, steps };
    }
  }
  if (start !== -1 && end < start) {
    return { ok: false, error: "Unexpected end of JSON input (output looks truncated — was max_tokens too low?)", steps };
  }
  return { ok: false, error: "Expected a JSON object but the model answered in prose", steps };
}

export interface ParsedOutput {
  ok: boolean;
  value?: Record<string, unknown>;
  error?: { type: "parse" | "schema"; message: string; issues: ValidationIssue[] };
  steps: string[];
}

export function parseStructured(text: string, schema: ObjectSchema): ParsedOutput {
  const ex = extractJson(text);
  if (!ex.ok) {
    return { ok: false, error: { type: "parse", message: ex.error ?? "Could not parse JSON", issues: [] }, steps: ex.steps };
  }
  const v = validate(ex.value, schema);
  if (!v.valid) {
    return {
      ok: false,
      value: v.value,
      error: { type: "schema", message: v.issues.map((i) => `${i.path}: ${i.message}`).join("; "), issues: v.issues },
      steps: [...ex.steps, "Schema validation failed"],
    };
  }
  return { ok: true, value: v.value, steps: [...ex.steps, "Schema validation passed"] };
}
