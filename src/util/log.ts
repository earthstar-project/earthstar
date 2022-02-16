/**
 * Logs are assigned a priority number.
 * Higher numbers are less important information.
 * Set your desired log level higher to get more info.
 *
 *  -1 nothing
 *   0 only errors
 *   1 also warnings
 *   2 also logs
 *   3 also debugs
 *
 * Logs also come from different "sources" which can
 * have different log level settings.
 *
 * Two ways to modify the log level settings:
 *
 * 1. Set an environment variable in the shell.
 *    This applies to all "sources" (can't be set individually)
 *         EARTHSTAR_LOG_LEVEL=2 npm run test
 *
 * 2. Use setLogLevels() to globally modify the levels:
 *         setLogLevels({ sync: 2 });
 *
 * The environment variable wins over the numbers set by setLogLevels.
 */

import { chalk } from "../../deps.ts";

//================================================================================
// TYPES

type LogSource = string;

export enum LogLevel {
    None = -1,
    Error = 0, // default
    Warn = 1,
    Log = 2,
    Info = 3,
    Debug = 4, // most verbose
}
export const DEFAULT_LOG_LEVEL = LogLevel.Error;

type LogLevels = Record<LogSource, LogLevel>;

//================================================================================
// ENV VAR

/*
// get the single log level number from the environment, or undefined if not set
const readEnvLogLevel = (): LogLevel | undefined => {
    if (process?.env?.EARTHSTAR_LOG_LEVEL) {
        const parsed = parseInt(process.env.EARTHSTAR_LOG_LEVEL);
        if (isNaN(parsed)) { return undefined }
        if (parsed !== Math.floor(parsed)) { return undefined; }
        return parsed;
    }
    return undefined;
}

// apply env var setting
const ENV_LOG_LEVEL = readEnvLogLevel();
*/

//================================================================================
// GLOBAL SETTINGS

// make global singleton to hold log levels
let globalLogLevels: LogLevels = {
    // result is the min of (_env) and anything else
    _default: DEFAULT_LOG_LEVEL,
};

export function updateLogLevels(newLogLevels: LogLevels): void {
    globalLogLevels = {
        ...globalLogLevels,
        ...newLogLevels,
    };
}

export function setLogLevel(source: LogSource, level: LogLevel) {
    globalLogLevels[source] = level;
}

export function setDefaultLogLevel(level: LogLevel) {
    globalLogLevels._default = level;
}

export function getLogLevel(source: LogSource): LogLevel {
    if (source in globalLogLevels) {
        return globalLogLevels[source];
    } else {
        return globalLogLevels._default;
    }
}

export function getLogLevels(): LogLevels {
    return globalLogLevels;
}

//================================================================================
// Logger class

type ChalkColor =
    | "blue"
    | "blueBright"
    | "bold"
    | "cyan"
    | "cyanBright"
    | "dim"
    | "gray"
    | "green"
    | "greenBright"
    | "grey"
    | "magenta"
    | "magentaBright"
    | "red"
    | "redBright"
    | "white"
    | "whiteBright"
    | "yellow"
    | "yellowBright";

export class Logger {
    source: LogSource;
    color: ChalkColor | undefined = undefined;

    constructor(source: LogSource, color?: ChalkColor) {
        this.source = source;
        this.color = color || "blueBright";
    }

    _print(level: LogLevel, showTag: boolean, indent: string, ...args: any[]) {
        if (level <= getLogLevel(this.source)) {
            if (showTag) {
                let tag = `[${this.source}]`;
                if (this.color !== undefined) {
                    tag = (chalk as any)[this.color](tag);
                }
                console.log(indent, tag, ...args);
            } else {
                console.log(indent, ...args);
            }
        }
    }

    error(...args: any[]) {
        this._print(LogLevel.Error, true, "!!", ...args);
    }
    warn(...args: any[]) {
        this._print(LogLevel.Warn, true, "! ", ...args);
    }
    log(...args: any[]) {
        this._print(LogLevel.Log, true, "  ", ...args);
    }
    info(...args: any[]) {
        this._print(LogLevel.Info, true, "    ", ...args);
    }
    debug(...args: any[]) {
        this._print(LogLevel.Debug, true, "      ", ...args);
    }

    blank() {
        this._print(LogLevel.Info, false, "");
    }
}
