import pino from "pino";

export const pinoConfig = {
  level: "info",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      messageFormat:
        '{levelLabel}: {msg} - {req?.remoteAddress}:{req?.remotePort} - "{req?.method} {req?.url} HTTP/{req?.httpVersion}" {res?.statusCode} {res?.statusMessage}',
      ignore: "pid,hostname,time",
      translateTime: false,
    },
  },
};

const logger = pino(pinoConfig);

export default logger;
