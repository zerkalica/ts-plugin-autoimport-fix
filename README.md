# tsserver autoimport fix plugin

Usable for ide's, which uses tsserver autoimport feature (vscode, sublime).

Removes dist part from import paths, removes packages not in the nearest package.json dependencies, devDependencies from suggestion.

Fixes for:
  https://github.com/microsoft/TypeScript/issues/40911
  https://github.com/microsoft/TypeScript/issues/40913

Demo: https://github.com/zerkalica/ts-references-autoimport-bug

## Install

tsconfig.json:

```json
{
  "compilerOptions": {
    "plugins": [
      {"name": "ts-plugin-autoimport-fix"}
    ]
  }
}
```

If you do not use reexports (index.ts) between the packages in monorepo, you still need to create empty index.ts and keep valid "types" section in package.json of each package.
