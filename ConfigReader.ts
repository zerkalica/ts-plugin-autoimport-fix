import * as ts_module from 'typescript/lib/tsserverlibrary'
import path from 'path'

export class ConfigReader {
  protected configs = new Map<string, ts_module.ParsedCommandLine | null>()
  constructor(protected tsm: typeof ts_module) {}

  get(mayBeProjectDir: string) {
    const tsm = this.tsm
    const configs = this.configs

    let config = configs.get(mayBeProjectDir)
    if (config !== undefined) return config

    const configFileNamePath = tsm.findConfigFile(mayBeProjectDir, tsm.sys.fileExists)
    const realProjectDir = configFileNamePath ? path.dirname(configFileNamePath) : undefined
    config = realProjectDir ? configs.get(realProjectDir) : undefined

    if (config !== undefined) return config

    const result = configFileNamePath ? tsm.readConfigFile(configFileNamePath, tsm.sys.readFile) : undefined
    config =
      result?.config && realProjectDir
        ? tsm.parseJsonConfigFileContent(
            result.config,
            tsm.sys,
            realProjectDir,
            undefined,
            configFileNamePath
          ) ?? null
        : null

    configs.set(mayBeProjectDir, config)
    if (realProjectDir && realProjectDir !== mayBeProjectDir) configs.set(realProjectDir, config)

    return config
  }
}
