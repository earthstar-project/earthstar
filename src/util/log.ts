
// Logs are assigned a priority number.
// Higher numbers are less important information.
// Set your desired log level higher to get more info.
// -1 shows nothing.
// 0 only shows errors.
// 1 also shows warnings.
// 2 also shows logs.
// 3 also shows debugs.

// Logs also come from different "sources" which can
// have different log level settings.

// Two ways to modify the log level settings:
//
// 1. Set an environment variable in the shell.
//    This applies to all "sources" (can't be set individually)
//         EARTHSTAR_LOG_LEVEL=2 npm run test
//
// 2. Use setLogLevels() to globally modify the levels:
//         setLogLevels({ sync: 2 });
//
// The environment variable wins over the numbers set by setLogLevels.

type LogSource = 'sync' | 'storage' | string;

enum LogLevel {
  // Level 0, error, is enabled by default
  // Set logLevel to -1 to hide errors.
  Error = 0,
  Warn = 1,
  Log = 2,
  Debug = 3,
};

type LogLevelSettings = Record<LogSource, LogLevel>

// get the single log level number from the environment, or undefined if not set
function readEnvLogLevel(): number | undefined {
  if (process?.env?.EARTHSTAR_LOG_LEVEL) {
    const parsed = parseInt(process.env.EARTHSTAR_LOG_LEVEL);
    return parsed === NaN ? undefined : parsed;
  }
  return undefined;
}
const envLogLevel = readEnvLogLevel();

// set up an env-levels overlay that will go on top of our
// manually set logLevel settings from setLogLevels()
const envLogLevels: Partial<LogLevelSettings> =
  envLogLevel === undefined
  ? {}
  : {
    sync: envLogLevel,
    storage: envLogLevel,
    _other: envLogLevel,
};

// set initial defaults to 1 (errors and warnings)
let currentLogLevelSettings: LogLevelSettings = {
  sync: 1,
  storage: 1,
  _other: 1,
}
currentLogLevelSettings = Object.assign(currentLogLevelSettings, envLogLevels);

// global singleton to modify log levels...
export function setLogLevels(newLogLevels: Partial<LogLevelSettings>): void {
  currentLogLevelSettings = Object.assign(currentLogLevelSettings, newLogLevels);
  // env settings always win, so apply them again
  currentLogLevelSettings = Object.assign(currentLogLevelSettings, envLogLevels);
}

export default class Logger {
  _source: LogSource
  
  constructor(source: LogSource) {
    this._source = source;
  }
  
  debug(...args:  any[]) {    
    let allowedLevel = currentLogLevelSettings[this._source] ?? currentLogLevelSettings['_other'];
    if (allowedLevel >= LogLevel.Debug) {
      console.error(`[${this._source} debug]`, ...args)
    }
  }
  
  log(...args:  any[]) {
    let allowedLevel = currentLogLevelSettings[this._source] ?? currentLogLevelSettings['_other'];
    if (allowedLevel >= LogLevel.Log) {
      console.error(`[${this._source} log]`, ...args)
    }
  }
  
  warn(...args:  any[]) {
    let allowedLevel = currentLogLevelSettings[this._source] ?? currentLogLevelSettings['_other'];
    if (allowedLevel >= LogLevel.Warn) {
      console.error(`[${this._source} warn]`, ...args)
    }
  }
  
  error(...args:  any[]) {
    let allowedLevel = currentLogLevelSettings[this._source] ?? currentLogLevelSettings['_other'];
    if (allowedLevel >= LogLevel.Error) {
      console.error(`[${this._source} error]`, ...args)
    }
  }
}