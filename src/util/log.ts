type LogSource = 'sync' | 'storage' 

enum LogLevel {
  Error,
  Warn,
  Log,
  Debug
};

type LogLevelSettings = Record<LogSource, LogLevel>

const logLevelSettings : LogLevelSettings = {
  sync: 0,
  storage: 0
}

export function setLogLevels(logLevels: Partial<LogLevelSettings>): void {
  Object.assign(logLevelSettings, logLevels)
}

export default class Logger {
  _source: LogSource
  
  constructor(source: LogSource) {
    this._source = source;
  }
  
  debug(...args:  any[]) {
    if (logLevelSettings[this._source] >= LogLevel.Debug) {
      console.debug(args)
    }
  }
  
  log(...args:  any[]) {
    if (logLevelSettings[this._source] >= LogLevel.Log) {
      console.log(args)
    }
  }
  
  warn(...args:  any[]) {
    if (logLevelSettings[this._source] >= LogLevel.Warn) {
      console.warn(args)
    }
  }
  
  error(...args:  any[]) {
    if (logLevelSettings[this._source] >= LogLevel.Error) {
      console.error(args)
    }
  }
}