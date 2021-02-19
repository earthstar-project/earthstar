type LogSource = 'sync' | 'storage' 

enum LogLevel {
  Error,
  Warn,
  Log,
  Debug
};

type LogLevelSettings = Record<LogSource, LogLevel>

function initLogLevel(defaultLevel: number): number {
  if (process?.env?.EARTHSTAR_LOG_LEVEL) {
    const parsed = parseInt(process.env.EARTHSTAR_LOG_LEVEL);
    
    return parsed === NaN ? defaultLevel : parsed;
  }
  
  return defaultLevel;
}

const logLevelSettings : LogLevelSettings = {
  sync: initLogLevel(0),
  storage: initLogLevel(0)
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