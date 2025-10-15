import { CLIError } from "@oclif/errors";

interface CmdArg {
  name: string;
  description: string;
}

interface Args {
  [name: string]: any;
}

export const readPipe: () => Promise<string> = () => {
  return new Promise(resolve => {
    const stdin = process.stdin;
    stdin.setEncoding("utf-8");

    // If running in a TTY (no pipe), return immediately
    if (stdin.isTTY) {
      return resolve("");
    }

    // If there's no data available immediately, set a short timeout to avoid hanging
    let data = "";
    const onData = (chunk: string) => {
      data += chunk;
    };
    const onEnd = () => {
      cleanup();
      resolve(data);
    };
    const onReadable = () => {
      // if readable fires but no data, schedule micro-timeout to break
      const chunk = stdin.read();
      if (chunk) {
        data += chunk.toString();
      }
    };
    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.removeListener("end", onEnd);
      stdin.removeListener("readable", onReadable);
    };

    stdin.on("data", onData);
    stdin.on("end", onEnd);
    stdin.on("readable", onReadable);

    // Safety: if nothing arrives within 50ms, assume no pipe and resolve
    setTimeout(() => {
      if (!data) {
        cleanup();
        resolve("");
      }
    }, 50);
  });
};

export const argsWithPipe = async (
  cmdArgs: CmdArg[],
  recievedArgs: Args,
  required?: boolean
): Promise<Args> => {
  const lastArg = cmdArgs[cmdArgs.length - 1];
  const lastArgName = lastArg.name;
  // if not args for cmd, or if the last arg already has a value
  // go ahead and return the result the user explicitly specified
  if (!lastArg || recievedArgs[lastArgName]) return recievedArgs;

  // if user hasn't specified a value for the last arg
  // look to see if we've recieved a value from stdin
  const pipeValue = await readPipe();

  // we were not piped a value
  if (!pipeValue) {
    if (required) {
      // copies the error output if we added the required flag in the arg option
      // that wont work however since we need it to be not required to allow pipe to override if present
      throw new CLIError(
        `Missing 1 required arg:\n${lastArgName}  ${lastArg.description}\nSee more help with --help`
      );
    }

    return recievedArgs;
  }

  // we were piped a value, override the recieved args to have piped value
  return {
    ...recievedArgs,
    [lastArgName]: pipeValue
  };
};
