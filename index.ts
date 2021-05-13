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

class IsValidAcc {
  isValid = false
  constructor(readonly source: string) {}
}

function init({ typescript: ts }: { typescript: typeof ts_module }) {
  const configReader = new ConfigReader(ts)
  const monorepoRoots = new Set<string>()

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
      // result.push(item)

      if (!item.endsWith('d.ts')) continue
      // Fix paths only from monorepo
      if (item.includes('node_modules')) continue

      const itemPath = path.dirname(item)

      const config = configReader.get(itemPath)
      const outDir = config?.options.outDir ?? itemPath
      const rootDir = config?.options.rootDir ?? path.dirname(itemPath)

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

    function isValidEntry(this: IsValidAcc, root: string) {
      if (this.source.startsWith(root)) this.isValid = true
    }

    /**
     * Remove suggests, not from package.json dependencies of current project
     * https://github.com/microsoft/TypeScript/issues/40911
     */
    proxy.getCompletionsAtPosition = (fileName, position, options) => {
      const prev = ls.getCompletionsAtPosition(fileName, position, options)

      if (!prev) return prev
      const entries = prev.entries
      const nextEntries = [] as typeof prev.entries
      const added = new Set<string>()
      for (let i = 0, l = entries.length; i < l; i++) {
        const e = entries[i]
        const source = e.source
        if (source === undefined) {
          nextEntries.push(e)
          continue
        }

        if (added.has(source)) continue
        added.add(source)

        // Check paths only from monorepo
        if (
          e.isPackageJsonImport === undefined
          || source.startsWith(currenDirectory)
          || source.includes('node_modules')
        ) {
          nextEntries.push(e)
          continue
        }

        const acc = new IsValidAcc(source)
  
        monorepoRoots.forEach(isValidEntry, acc)
  
        if (acc.isValid) nextEntries.push(e)
      }

      return {
        ...prev,
        entries: nextEntries,
      }
    }

    return proxy
  }

  return { create }
}

export = init
