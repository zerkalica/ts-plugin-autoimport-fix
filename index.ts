import path from 'path'
import * as ts_module from 'typescript/lib/tsserverlibrary'

import { ConfigReader } from './ConfigReader'

type TAutoImportProviderProject = ts_module.server.AutoImportProviderProject & {
  getRootFileNames(
    dependencySelection: ts.UserPreferences,
    hostProject: ts.server.Project,
    moduleResolutionHost: ts.ModuleResolutionHost,
    compilerOptions: ts.CompilerOptions
  ): string[]
}

function init({ typescript: ts }: { typescript: typeof ts_module }) {
  const configReader = new ConfigReader(ts)

  const monorepoRoots = new Set<string>()

  let dist = 'dist'

  const AutoImportProviderProject = (ts.server
    .AutoImportProviderProject as unknown) as TAutoImportProviderProject

  const getRootFileNames = AutoImportProviderProject.getRootFileNames

  /**
   * If autoimport suggest module with empty index - add to suggest all package sources.
   * https://github.com/microsoft/TypeScript/issues/40913#example-1
   */
  AutoImportProviderProject.getRootFileNames = function getRootFileNamesFixed(
    dependencySelection: ts.UserPreferences,
    hostProject: ts.server.ConfiguredProject,
    moduleResolutionHost: ts.ModuleResolutionHost,
    compilerOptions: ts.CompilerOptions
  ) {
    const imports: string[] = getRootFileNames.call(
      this,
      dependencySelection,
      hostProject,
      moduleResolutionHost,
      compilerOptions
    )

    const result: string[] = []

    for (const item of imports) {
      result.push(item)

      // Fix paths only from monorepo
      if (item.includes('node_modules')) continue
      if (!item.endsWith('d.ts')) continue

      const itemPath = path.dirname(item)

      const config = configReader.get(itemPath)
      const outDir = config?.options.outDir ?? itemPath
      const rootDir = config?.options.rootDir ?? path.dirname(itemPath)

      /**
       * Autodetect dist from tsconfig
       */
      if (config?.options.outDir) dist = path.basename(outDir)

      /**
       * Save all monorepo project dependencies paths for filtering imports in getCompletionsAtPosition
       */
      monorepoRoots.add(rootDir)

      const files = hostProject.readDirectory(
        rootDir,
        ['.ts', '.tsx'],
        ['node_modules', ...(config?.raw?.exclude ?? [])],
        config?.raw?.include
      )

      for (const file of files) {
        const fileRelative = file.substring(rootDir.length + 1)
        const relativeDep = `${outDir}/${fileRelative.replace(/(\.tsx?)$/, '.d$1')}`
        result.push(relativeDep)
      }
    }

    return result
  }

  function create(info: ts.server.PluginCreateInfo) {
    const proxy: typeof info.languageService = Object.create(null)
    const ls = info.languageService

    for (const k of Object.keys(ls) as (keyof ts.LanguageService)[]) {
      const x = ls[k] as any
      proxy[k] = typeof x === 'function' ? x.bind(ls) : x
    }

    const currenDirectory = info.project.getCurrentDirectory()

    function isValidImport(importPath: string) {
      // Check paths only from monorepo
      if (importPath.includes('node_modules')) return true
      if (importPath.startsWith(currenDirectory)) return true

      let isValid = false

      monorepoRoots.forEach(root => {
        if (importPath.startsWith(root)) isValid = true
      })

      return isValid
    }

    /**
     * Remove suggests, not from package.json dependencies of current project
     * https://github.com/microsoft/TypeScript/issues/40911
     */
    proxy.getCompletionsAtPosition = (fileName, position, options) => {
      const prev = ls.getCompletionsAtPosition(fileName, position, options)
      if (!prev) return prev

      return {
        ...prev,
        entries: prev.entries.filter(
          entry => !entry.source || !entry.isPackageJsonImport || isValidImport(entry.source)
        ),
      }
    }

    const importRegEx = new RegExp('^(import .*[\"\'])(.*)([\"\'].*[\\n\\r]*)', 'm')

    function removeImportDistPart(importStr: string) {
      const parts = importStr.match(importRegEx)
      if (! parts) return importStr

      const newImport = parts[2].replace(`/${dist}/`, '/')

      return `${parts[1]}${newImport}${parts[3]}`
    }

    /**
     * Remove `/dist/` part from import (tsserver insert it, when no index.js reexport)
     * https://github.com/microsoft/TypeScript/issues/40913#example-2
     */
    proxy.getCompletionEntryDetails = (fileName, position, entryName, formatOptions, src, preferences) => {
      const prev = ls.getCompletionEntryDetails(fileName, position, entryName, formatOptions, src, preferences)
      if (!prev || ! prev.codeActions || ! prev.source) return prev

      const codeActions = prev.codeActions.map(action => ({
        commands: action.commands,
        description: action.description,
        changes: action.changes.map(change => ({
          fileName: change.fileName,
          isNewFile: change.isNewFile,
          textChanges: change.textChanges.map(textChange => ({
            span: textChange.span,
            newText: removeImportDistPart(textChange.newText)
          }))
        }))
      }))
      
      return { ...prev, codeActions }
    }

    return proxy
  }

  return { create }
}

export = init
