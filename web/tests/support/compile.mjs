import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const webRoot = new URL("../../", import.meta.url);

export const moduleUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

/**
 * Compiles a real source file (path relative to web/) into an importable
 * module. Every import must be listed in `stubs`, so a test names exactly
 * which collaborators are real and which are replaced.
 */
export async function compileSource(path, stubs, label = "route") {
  const source = await readFile(new URL(path, webRoot), "utf8");
  const compiled = ts
    .transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    })
    .outputText.replace(/from (["'])([^"']+)\1/g, (_match, _quote, name) => {
      assert.ok(stubs[name], `Unmocked ${label} import: ${name} (in ${path})`);
      return `from ${JSON.stringify(stubs[name])}`;
    });
  return moduleUrl(compiled);
}

/** Compiles several real files in order and registers each under its import name. */
export async function compileInto(stubs, entries, label = "route") {
  for (const [name, path] of entries) stubs[name] = await compileSource(path, stubs, label);
}
