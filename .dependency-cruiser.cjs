// Layer and module boundaries. See docs/decisions/0001-stack.md and the
// Implementation Roadmap ("Build approach"). CI fails on any violation.
//
// Layout: src/<module>/<layer>/..., with src/<module>/index.ts as the only
// door into a module. One exception: any domain may import src/shared/domain,
// which itself imports nothing (docs/scope-v0.1-v0.2.md).

const UI_AND_FRAMEWORK_PACKAGES =
  "node_modules/(@zubra/[^/]+|zubra|@potomac-solutions/kit/components|hono|react|react-dom|preact|vue|svelte|@angular/[^/]+|solid-js|lit)(/|$)";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "core-no-zubra-or-ui-framework",
      comment:
        "domain and application must run with no Zubra and no UI framework installed.",
      severity: "error",
      from: { path: "^src/[^/]+/(domain|application)/" },
      to: { path: UI_AND_FRAMEWORK_PACKAGES },
    },
    {
      name: "domain-imports-nothing-outside-itself",
      comment:
        "domain may import only its own module's domain folder and src/shared/domain: no packages, no Node modules, no other layer, no other module.",
      severity: "error",
      from: { path: "^src/([^/]+)/domain/", pathNot: "\\.test\\.ts$" },
      to: { pathNot: ["^src/$1/domain/", "^src/shared/domain/"] },
    },
    {
      name: "domain-tests-stay-pure",
      comment:
        "domain tests may import their own domain, src/shared/domain, node:test and node:assert, nothing else.",
      severity: "error",
      from: { path: "^src/([^/]+)/domain/.+\\.test\\.ts$" },
      to: {
        pathNot: ["^src/$1/domain/", "^src/shared/domain/", "^(node:)?(test|assert)(/strict)?$"],
      },
    },
    {
      name: "application-imports-domain-only",
      comment:
        "application may import its own domain and application, and other modules through their index.ts. No packages.",
      severity: "error",
      from: { path: "^src/([^/]+)/application/", pathNot: "\\.test\\.ts$" },
      to: {
        pathNot: ["^src/$1/(domain|application)/", "^src/[^/]+/index\\.ts$"],
      },
    },
    {
      name: "no-other-module-internals",
      comment:
        "a module is entered through src/<module>/index.ts only. Reaching into another module's folders is forbidden. (Domain folders are held to the stricter domain rule above.)",
      severity: "error",
      from: { path: "^src/([^/]+)/", pathNot: "^src/[^/]+/domain/" },
      to: {
        path: "^src/[^/]+/",
        pathNot: ["^src/$1/", "^src/[^/]+/index\\.ts$"],
      },
    },
    {
      name: "infrastructure-not-api-or-ui",
      comment: "infrastructure may import domain and application, not api or ui.",
      severity: "error",
      from: { path: "^src/([^/]+)/infrastructure/" },
      to: { path: "^src/$1/(api|ui)/" },
    },
    {
      name: "api-imports-application-only",
      comment:
        "api calls application services. It may not reach domain, infrastructure or ui.",
      severity: "error",
      from: { path: "^src/([^/]+)/api/" },
      to: { path: "^src/$1/(domain|infrastructure|ui)/" },
    },
    {
      name: "ui-imports-api-contracts-only",
      comment: "ui may import its own files and its module's api/contracts, nothing else in src.",
      severity: "error",
      from: { path: "^src/([^/]+)/ui/" },
      to: { path: "^src/", pathNot: "^src/$1/(ui|api/contracts)/" },
    },
    {
      name: "no-circular",
      comment: "no import cycles.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "node", "default"],
      extensions: [".ts", ".js", ".mjs", ".cjs"],
    },
  },
};
